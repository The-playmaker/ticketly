/**
 * Nets Easy reconciliation apply path.
 */
import {
  PaymentProviderType,
  PaymentStatus,
  RefundStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { PaymentService } from "@/services/payment-service";
import { mapWithConcurrency } from "@/lib/payments/stripe-retry";
import {
  createLiveNexiLookupClient,
  lookupNexiForPayment,
  type NexiOrderLookup,
} from "@/lib/payments/nexi-lookup";
import { normalizeNexiPaymentMethod } from "@/lib/payments/nexi-status";
import type {
  NexiReconcileOptions,
  NexiReconcileResult,
  NexiReconciliationRow,
} from "./nexi-payment-reconciliation-body";

function portalUrl(paymentId: string | null, env: "test" | "production"): string | null {
  if (!paymentId) return null;
  void env;
  return paymentId;
}

export async function nexiReconcileOrder(
  host: {
    decide: typeof import("./nexi-payment-reconciliation-body").NexiPaymentReconciliationService.decide;
  },
  orderId: string,
  opts: NexiReconcileOptions = {}
): Promise<NexiReconciliationRow> {
  const apply = !!opts.apply;
  const client = opts.nexiClient ?? createLiveNexiLookupClient();

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      payments: {
        where: {
          provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
        },
        orderBy: { createdAt: "desc" },
      },
      refunds: true,
    },
  });

  const payment = order.payments[0];
  const ticketlyRefunded = order.refunds
    .filter((r) => r.status === RefundStatus.SUCCEEDED)
    .reduce((s, r) => s + r.amount, 0);

  if (!payment?.providerPaymentId) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      ticketlyStatus: order.paymentStatus,
      nexiChargedAmount: null,
      nexiReservedAmount: null,
      nexiRefundedAmount: null,
      amountMatch: null,
      currencyMatch: null,
      providerPaymentId: null,
      providerChargeId: null,
      proposedAction: "none",
      anomalyReason: "LOOKUP_ERROR",
      applied: false,
      detail: "missing_provider_payment_id",
    };
  }

  let lookup: NexiOrderLookup;
  try {
    lookup = await lookupNexiForPayment(payment.providerPaymentId, client);
  } catch (e) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      ticketlyStatus: order.paymentStatus,
      nexiChargedAmount: null,
      nexiReservedAmount: null,
      nexiRefundedAmount: null,
      amountMatch: null,
      currencyMatch: null,
      providerPaymentId: payment.providerPaymentId,
      providerChargeId: payment.providerChargeId,
      proposedAction: "none",
      anomalyReason: "LOOKUP_ERROR",
      applied: false,
      detail: e instanceof Error ? e.message.slice(0, 200) : "lookup_failed",
    };
  }

  const decision = host.decide({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
      currency: order.currency,
      paymentStatus: order.paymentStatus,
      paymentAnomaly: order.paymentAnomaly,
    },
    ticketlyRefunded,
    lookup,
  });

  let applied = false;
  let detail = decision.detail;

  if (
    apply &&
    decision.action !== "none" &&
    decision.action !== "verify_ok" &&
    decision.action !== "skip_conflict"
  ) {
    try {
      if (decision.action === "mark_paid") {
        const method = normalizeNexiPaymentMethod(lookup.paymentMethod);
        await PaymentService.markOrderPaid({
          orderId: order.id,
          provider: payment.provider,
          providerSessionId: payment.providerSessionId ?? lookup.paymentId,
          providerPaymentId: lookup.paymentId,
          providerChargeId: lookup.chargeId ?? payment.providerChargeId ?? undefined,
          paymentMethod: method.paymentMethod,
          paymentType: method.paymentType ?? lookup.paymentType ?? undefined,
          providerStatus: "reconciled_nexi_paid",
          externalEventId: `reconcile_nexi_${lookup.paymentId}`,
          amount: decision.amount ?? lookup.chargedAmount,
          currency: decision.currency ?? lookup.currency ?? order.currency,
        });
        applied = true;
      } else if (decision.action === "mark_failed") {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: PaymentStatus.FAILED },
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, providerStatus: "reconciled_failed" },
        });
        applied = true;
      } else if (decision.action === "mark_cancelled") {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: PaymentStatus.CANCELLED },
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.CANCELLED,
            providerStatus: "reconciled_cancelled",
          },
        });
        applied = true;
      } else if (decision.action === "mark_review") {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: PaymentStatus.REVIEW_REQUIRED,
            paymentAnomaly: true,
            paymentAnomalyReason: decision.anomaly ?? "REVIEW_REQUIRED",
          },
        });
        applied = true;
      } else if (decision.action === "sync_refunds") {
        let created = 0;
        for (const r of lookup.refunds) {
          if (r.status !== "Completed") continue;
          const existing = await prisma.refund.findUnique({
            where: { providerRefundId: r.id },
          });
          if (existing) continue;
          await prisma.refund.create({
            data: {
              orderId: order.id,
              paymentId: payment.id,
              amount: r.amount,
              currency: order.currency,
              status: RefundStatus.SUCCEEDED,
              reason: "nexi_reconciliation",
              providerRefundId: r.id,
              ticketIds: [],
              processedById: opts.actorId,
            },
          });
          created++;
        }
        const succeeded = await prisma.refund.aggregate({
          where: { orderId: order.id, status: RefundStatus.SUCCEEDED },
          _sum: { amount: true },
        });
        const refundedSum = succeeded._sum.amount ?? 0;
        const nextStatus =
          refundedSum <= 0
            ? order.paymentStatus
            : refundedSum >= order.total
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED;
        if (
          nextStatus === PaymentStatus.REFUNDED ||
          nextStatus === PaymentStatus.PARTIALLY_REFUNDED
        ) {
          await prisma.order.update({
            where: { id: order.id },
            data: { paymentStatus: nextStatus },
          });
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: nextStatus, providerStatus: "refund_reconciled" },
          });
        }
        applied = created > 0;
        detail = `refunds_synced=${created}`;
      }

      if (applied) {
        await writeAuditLog({
          actorId: opts.actorId,
          organizationId: order.organizationId,
          action: "PAYMENT_RECONCILED",
          entityType: "Order",
          entityId: order.id,
          metadata: {
            provider: "NEXI",
            action: decision.action,
            providerPaymentId: lookup.paymentId,
            chargedAmount: lookup.chargedAmount,
            portalRef: portalUrl(lookup.paymentId, "production"),
          },
        });
      }
    } catch (e) {
      detail = e instanceof Error ? e.message.slice(0, 200) : "apply_failed";
      await writeAuditLog({
        organizationId: order.organizationId,
        action: "PAYMENT_RECONCILIATION_MISMATCH",
        entityType: "Order",
        entityId: order.id,
        metadata: {
          provider: "NEXI",
          anomaly: decision.anomaly,
          error: detail,
          providerPaymentId: lookup.paymentId,
        },
      });
    }
  }

  const fresh = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { paymentStatus: true },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerEmail: order.customerEmail,
    ticketlyStatus: fresh.paymentStatus,
    nexiChargedAmount: lookup.chargedAmount,
    nexiReservedAmount: lookup.reservedAmount,
    nexiRefundedAmount: lookup.refundedAmount,
    amountMatch: decision.amountMatch,
    currencyMatch: decision.currencyMatch,
    providerPaymentId: lookup.paymentId,
    providerChargeId: lookup.chargeId,
    proposedAction: decision.action,
    anomalyReason: decision.anomaly,
    applied,
    detail,
  };
}

export async function nexiReconcile(
  host: {
    findCandidateOrders: typeof import("./nexi-payment-reconciliation-body").NexiPaymentReconciliationService.findCandidateOrders;
    reconcileOrder: typeof import("./nexi-payment-reconciliation-body").NexiPaymentReconciliationService.reconcileOrder;
  },
  opts: NexiReconcileOptions = {}
): Promise<NexiReconcileResult> {
  const apply = !!opts.apply;
  const concurrency = opts.concurrency ?? 5;
  const orders = await host.findCandidateOrders(opts);
  const rows = await mapWithConcurrency(orders, concurrency, async (order) =>
    host.reconcileOrder(order.id, opts)
  );
  const discrepancies = rows.filter(
    (r) =>
      r.anomalyReason != null ||
      (r.proposedAction !== "none" &&
        r.proposedAction !== "verify_ok" &&
        r.proposedAction !== "skip_conflict")
  ).length;

  return {
    dryRun: !apply,
    scanned: rows.length,
    applied: rows.filter((r) => r.applied).length,
    discrepancies,
    rows,
  };
}
