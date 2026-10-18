/**
 * Bidirectional payment status reconciliation: Stripe ↔ Ticketly.
 *
 * - Stripe is authoritative for payment state
 * - Ticketly is authoritative for order/ticket state
 * - Successful payments always go through PaymentService.markOrderPaid
 * - Never creates tickets directly from reconciliation
 */

import {
  PaymentProviderType,
  PaymentStatus,
  RefundStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { PaymentService } from "@/services/payment-service";
import {
  createLiveStripeLookupClient,
  lookupStripeForPayment,
  normalizeStripeLookupIds,
  type StripeLookupClient,
  type StripeOrderLookup,
  type StripePaymentIntentSnapshot,
  type StripeRefundSnapshot,
} from "@/lib/payments/stripe-lookup";
import { mapWithConcurrency } from "@/lib/payments/stripe-retry";

const CANDIDATE_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.FAILED,
  PaymentStatus.REVIEW_REQUIRED,
  PaymentStatus.AUTHORIZED,
  PaymentStatus.PARTIALLY_REFUNDED,
];

export type ReconciliationFilter =
  | "all"
  | "discrepancies"
  | "stripe_paid_ticketly_pending"
  | "failed"
  | "blocked_review"
  | "expired"
  | "refund_mismatch";

export type ReconciliationAction =
  | "none"
  | "mark_paid"
  | "mark_failed"
  | "mark_review"
  | "mark_cancelled"
  | "sync_refunds"
  | "verify_ok"
  | "skip_conflict";

export type ReconciliationAnomaly =
  | null
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "METADATA_ORDER_MISMATCH"
  | "METADATA_ORDER_NUMBER_MISMATCH"
  | "LIVEMODE_MISMATCH"
  | "RADAR_BLOCKED"
  | "RADAR_REVIEW"
  | "REFUND_MISMATCH"
  | "EXPIRED_SESSION_NO_PI"
  | "STRIPE_PAID_TICKETLY_PENDING"
  | "STRIPE_FAILED_TICKETLY_NOT_FAILED"
  | "LOOKUP_ERROR";

export type ReconciliationRow = {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  ticketlyStatus: PaymentStatus;
  stripeSessionStatus: string | null;
  stripeSessionPaymentStatus: string | null;
  stripePiStatus: string | null;
  amountMatch: boolean | null;
  currencyMatch: boolean | null;
  webhookLastSeenAt: string | null;
  providerSessionId: string | null;
  providerPaymentId: string | null;
  stripeDashboardUrl: string | null;
  proposedAction: ReconciliationAction;
  anomalyReason: ReconciliationAnomaly;
  applied: boolean;
  detail?: string;
};

export type ReconcileOptions = {
  apply?: boolean;
  sinceHours?: number;
  /** Include PAID orders from the last N hours for verification (default: sinceHours or 24) */
  paidVerifyHours?: number;
  orderId?: string;
  orderNumber?: string;
  limit?: number;
  concurrency?: number;
  filter?: ReconciliationFilter;
  stripeClient?: StripeLookupClient;
  actorId?: string;
};

export type ReconcileResult = {
  dryRun: boolean;
  scanned: number;
  applied: number;
  discrepancies: number;
  rows: ReconciliationRow[];
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function stripeDashboardUrl(ids: {
  sessionId?: string | null;
  paymentIntentId?: string | null;
  livemode?: boolean;
}): string | null {
  const base = ids.livemode === false ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  if (ids.paymentIntentId && !ids.paymentIntentId.startsWith("mock_") && !ids.paymentIntentId.startsWith("free_")) {
    return `${base}/payments/${ids.paymentIntentId}`;
  }
  if (ids.sessionId && !ids.sessionId.startsWith("mock_") && !ids.sessionId.startsWith("free_")) {
    return `${base}/checkout/sessions/${ids.sessionId}`;
  }
  return null;
}

function stripePaid(lookup: StripeOrderLookup): boolean {
  if (lookup.session?.paymentStatus === "paid") return true;
  if (lookup.paymentIntent?.status === "succeeded") return true;
  return false;
}

function isRadarBlocked(pi: StripePaymentIntentSnapshot | null): boolean {
  if (!pi) return false;
  if (pi.outcomeType === "blocked") return true;
  if (pi.lastPaymentErrorCode === "card_declined" && pi.outcomeType === "blocked") return true;
  return false;
}

function isRadarReview(pi: StripePaymentIntentSnapshot | null): boolean {
  if (!pi) return false;
  if (pi.outcomeType === "manual_review") return true;
  if (pi.status === "requires_capture" && pi.riskLevel === "elevated") return true;
  // Stripe Radar review hold often leaves PI in requires_action / processing with review outcome
  if (pi.outcomeType === "manual_review" || pi.riskLevel === "highest") return true;
  return false;
}

function isDefinitiveFailure(lookup: StripeOrderLookup): boolean {
  const pi = lookup.paymentIntent;
  if (stripePaid(lookup)) return false;
  if (isRadarBlocked(pi) || isRadarReview(pi)) return false;
  if (!pi) return false;
  if (pi.status === "canceled") return true;
  // Failed attempt that needs a new payment method, with an error recorded
  if (
    (pi.status === "requires_payment_method" || pi.status === "requires_confirmation") &&
    pi.lastPaymentErrorCode
  ) {
    return true;
  }
  return false;
}

function sessionExpiredNoSuccess(lookup: StripeOrderLookup): boolean {
  if (stripePaid(lookup)) return false;
  const s = lookup.session;
  if (!s) return false;
  return s.status === "expired";
}

type IntegrityCheck = {
  ok: boolean;
  anomaly: ReconciliationAnomaly;
  amountMatch: boolean | null;
  currencyMatch: boolean | null;
  amount?: number;
  currency?: string;
  detail?: string;
};

function checkPaidIntegrity(
  order: { id: string; orderNumber: string; total: number; currency: string },
  lookup: StripeOrderLookup
): IntegrityCheck {
  const session = lookup.session;
  const pi = lookup.paymentIntent;

  const amount = pi?.amount ?? session?.amountTotal ?? null;
  const currency = (pi?.currency ?? session?.currency ?? null)?.toUpperCase() ?? null;
  const livemode = pi?.livemode ?? session?.livemode;
  const meta = pi?.metadata ?? session?.metadata ?? {};

  const amountMatch = amount == null ? null : amount === order.total;
  const currencyMatch =
    currency == null ? null : currency === order.currency.toUpperCase();

  if (isProduction() && livemode === false) {
    return {
      ok: false,
      anomaly: "LIVEMODE_MISMATCH",
      amountMatch,
      currencyMatch,
      detail: "test_mode_payment_in_production",
    };
  }

  if (meta.orderId && meta.orderId !== order.id) {
    return {
      ok: false,
      anomaly: "METADATA_ORDER_MISMATCH",
      amountMatch,
      currencyMatch,
      detail: `metadata.orderId=${meta.orderId}`,
    };
  }

  if (meta.orderNumber && meta.orderNumber !== order.orderNumber) {
    return {
      ok: false,
      anomaly: "METADATA_ORDER_NUMBER_MISMATCH",
      amountMatch,
      currencyMatch,
      detail: `metadata.orderNumber=${meta.orderNumber}`,
    };
  }

  if (amountMatch === false) {
    return {
      ok: false,
      anomaly: "AMOUNT_MISMATCH",
      amountMatch,
      currencyMatch,
      amount: amount ?? undefined,
      currency: currency ?? undefined,
      detail: `expected=${order.total} got=${amount}`,
    };
  }

  if (currencyMatch === false) {
    return {
      ok: false,
      anomaly: "CURRENCY_MISMATCH",
      amountMatch,
      currencyMatch,
      amount: amount ?? undefined,
      currency: currency ?? undefined,
      detail: `expected=${order.currency} got=${currency}`,
    };
  }

  return {
    ok: true,
    anomaly: null,
    amountMatch: amountMatch ?? true,
    currencyMatch: currencyMatch ?? true,
    amount: amount ?? order.total,
    currency: currency ?? order.currency,
  };
}

function refundMismatch(
  orderTotal: number,
  ticketlyRefunded: number,
  stripeRefunds: StripeRefundSnapshot[]
): { mismatch: boolean; stripeSucceededSum: number } {
  const stripeSucceededSum = stripeRefunds
    .filter((r) => r.status === "succeeded")
    .reduce((s, r) => s + r.amount, 0);
  // Allow Ticketly to be ahead only if both cover full amount (or equal)
  if (stripeSucceededSum !== ticketlyRefunded) {
    // Treat as mismatch when Stripe has refunds Ticketly lacks, or totals differ
    return { mismatch: true, stripeSucceededSum };
  }
  void orderTotal;
  return { mismatch: false, stripeSucceededSum };
}

function matchesFilter(row: ReconciliationRow, filter: ReconciliationFilter): boolean {
  if (filter === "all") return true;
  if (filter === "discrepancies") {
    return (
      row.anomalyReason != null ||
      (row.proposedAction !== "none" &&
        row.proposedAction !== "verify_ok" &&
        row.proposedAction !== "skip_conflict")
    );
  }
  if (filter === "stripe_paid_ticketly_pending") {
    return (
      row.anomalyReason === "STRIPE_PAID_TICKETLY_PENDING" ||
      row.proposedAction === "mark_paid"
    );
  }
  if (filter === "failed") {
    return row.proposedAction === "mark_failed" || row.anomalyReason === "STRIPE_FAILED_TICKETLY_NOT_FAILED";
  }
  if (filter === "blocked_review") {
    return (
      row.anomalyReason === "RADAR_BLOCKED" ||
      row.anomalyReason === "RADAR_REVIEW" ||
      row.anomalyReason === "AMOUNT_MISMATCH" ||
      row.anomalyReason === "CURRENCY_MISMATCH" ||
      row.anomalyReason === "METADATA_ORDER_MISMATCH" ||
      row.anomalyReason === "METADATA_ORDER_NUMBER_MISMATCH" ||
      row.anomalyReason === "LIVEMODE_MISMATCH" ||
      row.proposedAction === "mark_review"
    );
  }
  if (filter === "expired") {
    return (
      row.anomalyReason === "EXPIRED_SESSION_NO_PI" || row.proposedAction === "mark_cancelled"
    );
  }
  if (filter === "refund_mismatch") {
    return row.anomalyReason === "REFUND_MISMATCH" || row.proposedAction === "sync_refunds";
  }
  return true;
}

export class PaymentReconciliationService {
  static async findCandidateOrders(opts: ReconcileOptions = {}) {
    const sinceHours = opts.sinceHours ?? 24;
    const paidVerifyHours = opts.paidVerifyHours ?? sinceHours;
    const limit = opts.limit ?? 200;
    const paidSince = new Date(Date.now() - paidVerifyHours * 3600_000);

    if (opts.orderId || opts.orderNumber) {
      return prisma.order.findMany({
        where: {
          ...(opts.orderId ? { id: opts.orderId } : {}),
          ...(opts.orderNumber ? { orderNumber: opts.orderNumber } : {}),
          payments: { some: { provider: PaymentProviderType.STRIPE } },
        },
        include: {
          payments: {
            where: { provider: PaymentProviderType.STRIPE },
            orderBy: { createdAt: "desc" },
          },
          refunds: true,
        },
        take: 1,
      });
    }

    return prisma.order.findMany({
      where: {
        payments: { some: { provider: PaymentProviderType.STRIPE } },
        OR: [
          { paymentStatus: { in: CANDIDATE_STATUSES } },
          {
            paymentStatus: PaymentStatus.PAID,
            paidAt: { gte: paidSince },
          },
          {
            paymentStatus: PaymentStatus.REFUNDED,
            updatedAt: { gte: paidSince },
          },
        ],
      },
      include: {
        payments: {
          where: { provider: PaymentProviderType.STRIPE },
          orderBy: { createdAt: "desc" },
        },
        refunds: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  }

  static decide(input: {
    order: {
      id: string;
      orderNumber: string;
      total: number;
      currency: string;
      paymentStatus: PaymentStatus;
      paymentAnomaly: boolean;
    };
    ticketlyRefunded: number;
    lookup: StripeOrderLookup;
  }): {
    action: ReconciliationAction;
    anomaly: ReconciliationAnomaly;
    amountMatch: boolean | null;
    currencyMatch: boolean | null;
    integrity?: IntegrityCheck;
    detail?: string;
  } {
    const { order, lookup, ticketlyRefunded } = input;
    const integrity = checkPaidIntegrity(order, lookup);

    // Strongest signal: successful Stripe payment
    if (stripePaid(lookup)) {
      if (!integrity.ok) {
        return {
          action: "mark_review",
          anomaly: integrity.anomaly,
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
          integrity,
          detail: integrity.detail,
        };
      }

      if (
        order.paymentStatus === PaymentStatus.PAID ||
        order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
        order.paymentStatus === PaymentStatus.REFUNDED
      ) {
        const { mismatch } = refundMismatch(order.total, ticketlyRefunded, lookup.refunds);
        if (mismatch && lookup.refunds.some((r) => r.status === "succeeded")) {
          return {
            action: "sync_refunds",
            anomaly: "REFUND_MISMATCH",
            amountMatch: integrity.amountMatch,
            currencyMatch: integrity.currencyMatch,
            integrity,
          };
        }
        return {
          action: "verify_ok",
          anomaly: null,
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
          integrity,
        };
      }

      // PENDING / FAILED / REVIEW / AUTHORIZED / CANCELLED → promote to PAID
      // Conflict policy: never leave paid Stripe money as FAILED because session expired
      return {
        action: "mark_paid",
        anomaly:
          order.paymentStatus === PaymentStatus.PENDING ||
          order.paymentStatus === PaymentStatus.AUTHORIZED
            ? "STRIPE_PAID_TICKETLY_PENDING"
            : "STRIPE_PAID_TICKETLY_PENDING",
        amountMatch: integrity.amountMatch,
        currencyMatch: integrity.currencyMatch,
        integrity,
      };
    }

    // Radar / review holds — no tickets
    if (isRadarBlocked(lookup.paymentIntent)) {
      if (order.paymentStatus === PaymentStatus.PAID) {
        return {
          action: "skip_conflict",
          anomaly: "RADAR_BLOCKED",
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
          detail: "will_not_downgrade_paid",
        };
      }
      return {
        action: "mark_review",
        anomaly: "RADAR_BLOCKED",
        amountMatch: integrity.amountMatch,
        currencyMatch: integrity.currencyMatch,
      };
    }

    if (isRadarReview(lookup.paymentIntent)) {
      if (order.paymentStatus === PaymentStatus.PAID) {
        return {
          action: "skip_conflict",
          anomaly: "RADAR_REVIEW",
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
          detail: "will_not_downgrade_paid",
        };
      }
      return {
        action: "mark_review",
        anomaly: "RADAR_REVIEW",
        amountMatch: integrity.amountMatch,
        currencyMatch: integrity.currencyMatch,
      };
    }

    // Expired session without successful PI — never downgrade confirmed PAID
    if (sessionExpiredNoSuccess(lookup)) {
      if (order.paymentStatus === PaymentStatus.PAID) {
        return {
          action: "skip_conflict",
          anomaly: null,
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
          detail: "paid_order_expired_session_ignored",
        };
      }
      if (
        order.paymentStatus === PaymentStatus.CANCELLED ||
        order.paymentStatus === PaymentStatus.FAILED
      ) {
        return {
          action: "none",
          anomaly: "EXPIRED_SESSION_NO_PI",
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
        };
      }
      return {
        action: "mark_cancelled",
        anomaly: "EXPIRED_SESSION_NO_PI",
        amountMatch: integrity.amountMatch,
        currencyMatch: integrity.currencyMatch,
      };
    }

    // Definitive Stripe failure
    if (isDefinitiveFailure(lookup)) {
      if (order.paymentStatus === PaymentStatus.PAID) {
        return {
          action: "skip_conflict",
          anomaly: "STRIPE_FAILED_TICKETLY_NOT_FAILED",
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
          detail: "will_not_downgrade_paid",
        };
      }
      if (order.paymentStatus === PaymentStatus.FAILED) {
        return {
          action: "none",
          anomaly: null,
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
        };
      }
      return {
        action: "mark_failed",
        anomaly: "STRIPE_FAILED_TICKETLY_NOT_FAILED",
        amountMatch: integrity.amountMatch,
        currencyMatch: integrity.currencyMatch,
      };
    }

    // Refund-only sync for already-paid paths handled above; partial refund candidates
    if (
      (order.paymentStatus === PaymentStatus.PAID ||
        order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
        order.paymentStatus === PaymentStatus.REFUNDED) &&
      lookup.refunds.length > 0
    ) {
      const { mismatch } = refundMismatch(order.total, ticketlyRefunded, lookup.refunds);
      if (mismatch) {
        return {
          action: "sync_refunds",
          anomaly: "REFUND_MISMATCH",
          amountMatch: integrity.amountMatch,
          currencyMatch: integrity.currencyMatch,
        };
      }
    }

    return {
      action: "none",
      anomaly: null,
      amountMatch: integrity.amountMatch,
      currencyMatch: integrity.currencyMatch,
    };
  }

  static async applyDecision(input: {
    orderId: string;
    organizationId: string;
    paymentId?: string;
    decision: ReturnType<typeof PaymentReconciliationService.decide>;
    lookup: StripeOrderLookup;
    actorId?: string;
  }): Promise<{ applied: boolean; detail?: string }> {
    const { decision, lookup, orderId } = input;
    const session = lookup.session;
    const pi = lookup.paymentIntent;

    switch (decision.action) {
      case "mark_paid": {
        // Clear anomaly only when integrity passed — markOrderPaid enforces again
        if (decision.integrity?.ok) {
          await prisma.order.update({
            where: { id: orderId },
            data: {
              paymentAnomaly: false,
              paymentAnomalyReason: null,
            },
          });
        }
        await PaymentService.markOrderPaid({
          orderId,
          provider: PaymentProviderType.STRIPE,
          providerSessionId: session?.id,
          providerPaymentId: pi?.id ?? session?.paymentIntentId ?? undefined,
          providerChargeId: pi?.chargeId ?? undefined,
          providerStatus: pi?.status ?? session?.paymentStatus ?? "reconciled_paid",
          externalEventId: `reconcile_${orderId}_${pi?.id ?? session?.id ?? "paid"}`,
          amount: decision.integrity?.amount,
          currency: decision.integrity?.currency,
        });
        await writeAuditLog({
          actorId: input.actorId,
          organizationId: input.organizationId,
          action: "PAYMENT_RECONCILED",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            action: "mark_paid",
            providerSessionId: session?.id ?? null,
            providerPaymentId: pi?.id ?? null,
            stripeSessionStatus: session?.status ?? null,
            stripePiStatus: pi?.status ?? null,
          },
        });
        return { applied: true };
      }

      case "mark_failed": {
        await prisma.order.update({
          where: { id: orderId },
          data: { paymentStatus: PaymentStatus.FAILED },
        });
        await prisma.payment.updateMany({
          where: { orderId, provider: PaymentProviderType.STRIPE },
          data: {
            status: PaymentStatus.FAILED,
            providerStatus: pi?.status ?? "failed",
          },
        });
        await writeAuditLog({
          actorId: input.actorId,
          organizationId: input.organizationId,
          action: "PAYMENT_RECONCILED",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            action: "mark_failed",
            providerPaymentId: pi?.id ?? null,
            stripePiStatus: pi?.status ?? null,
          },
        });
        return { applied: true };
      }

      case "mark_review": {
        const reason = decision.anomaly ?? "REVIEW_REQUIRED";
        await prisma.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: PaymentStatus.REVIEW_REQUIRED,
            paymentAnomaly: true,
            paymentAnomalyReason: reason,
          },
        });
        await prisma.payment.updateMany({
          where: { orderId, provider: PaymentProviderType.STRIPE },
          data: {
            status: PaymentStatus.REVIEW_REQUIRED,
            providerStatus: pi?.status ?? session?.status ?? "review",
          },
        });
        await writeAuditLog({
          actorId: input.actorId,
          organizationId: input.organizationId,
          action: "PAYMENT_REVIEW_REQUIRED",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            reason,
            providerSessionId: session?.id ?? null,
            providerPaymentId: pi?.id ?? null,
            stripePiStatus: pi?.status ?? null,
            detail: decision.detail ?? null,
          },
        });
        return { applied: true };
      }

      case "mark_cancelled": {
        await prisma.order.update({
          where: { id: orderId },
          data: { paymentStatus: PaymentStatus.CANCELLED },
        });
        await prisma.payment.updateMany({
          where: { orderId, provider: PaymentProviderType.STRIPE },
          data: {
            status: PaymentStatus.CANCELLED,
            providerStatus: session?.status ?? "expired",
          },
        });
        await writeAuditLog({
          actorId: input.actorId,
          organizationId: input.organizationId,
          action: "PAYMENT_RECONCILED",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            action: "mark_cancelled",
            providerSessionId: session?.id ?? null,
            stripeSessionStatus: session?.status ?? null,
          },
        });
        return { applied: true };
      }

      case "sync_refunds": {
        const synced = await this.syncRefunds({
          orderId,
          organizationId: input.organizationId,
          paymentId: input.paymentId,
          refunds: lookup.refunds,
          actorId: input.actorId,
        });
        return { applied: synced > 0, detail: `refunds_synced=${synced}` };
      }

      default:
        return { applied: false };
    }
  }

  /**
   * Upsert Ticketly Refund rows from successful Stripe refunds (by providerRefundId).
   * Updates order/payment to PARTIALLY_REFUNDED / REFUNDED. Does not alter tickets.
   */
  static async syncRefunds(input: {
    orderId: string;
    organizationId: string;
    paymentId?: string;
    refunds: StripeRefundSnapshot[];
    actorId?: string;
  }): Promise<number> {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { refunds: true, payments: { where: { provider: PaymentProviderType.STRIPE } } },
    });

    let created = 0;
    const paymentId = input.paymentId ?? order.payments[0]?.id;

    for (const r of input.refunds) {
      if (r.status !== "succeeded") continue;
      const existing = await prisma.refund.findUnique({
        where: { providerRefundId: r.id },
      });
      if (existing) {
        if (existing.status !== RefundStatus.SUCCEEDED) {
          await prisma.refund.update({
            where: { id: existing.id },
            data: { status: RefundStatus.SUCCEEDED, amount: r.amount },
          });
        }
        continue;
      }

      await prisma.refund.create({
        data: {
          orderId: order.id,
          paymentId,
          amount: r.amount,
          currency: (r.currency || order.currency).toUpperCase(),
          status: RefundStatus.SUCCEEDED,
          reason: "stripe_reconciliation",
          providerRefundId: r.id,
          ticketIds: [],
          processedById: input.actorId,
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
      await prisma.payment.updateMany({
        where: { orderId: order.id, provider: PaymentProviderType.STRIPE },
        data: { status: nextStatus, providerStatus: "refund_reconciled" },
      });
    }

    await writeAuditLog({
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: created > 0 ? "PAYMENT_RECONCILED" : "PAYMENT_RECONCILIATION_MISMATCH",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        action: "sync_refunds",
        created,
        refundedSum,
        nextStatus,
        stripeRefundIds: input.refunds.filter((r) => r.status === "succeeded").map((r) => r.id),
      },
    });

    return created;
  }

  static async reconcileOrder(
    orderId: string,
    opts: ReconcileOptions = {}
  ): Promise<ReconciliationRow> {
    const apply = !!opts.apply;
    const client = opts.stripeClient ?? createLiveStripeLookupClient();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        payments: {
          where: { provider: PaymentProviderType.STRIPE },
          orderBy: { createdAt: "desc" },
        },
        refunds: true,
      },
    });

    const payment = order.payments[0];
    const ticketlyRefunded = order.refunds
      .filter((r) => r.status === RefundStatus.SUCCEEDED)
      .reduce((s, r) => s + r.amount, 0);

    const lastWebhook = await prisma.webhookEvent.findFirst({
      where: {
        OR: [
          { orderId: order.id },
          payment?.providerPaymentId
            ? { paymentId: payment.providerPaymentId }
            : undefined,
        ].filter(Boolean) as object[],
        provider: PaymentProviderType.STRIPE,
      },
      orderBy: { receivedAt: "desc" },
      select: { receivedAt: true },
    });

    // Never treat cs_… as a PaymentIntent id (legacy rows stored session id as PI).
    const normalizedIds = normalizeStripeLookupIds({
      providerSessionId: payment?.providerSessionId,
      providerPaymentId: payment?.providerPaymentId,
    });

    let lookup: StripeOrderLookup;
    try {
      lookup = await lookupStripeForPayment(client, {
        sessionId: normalizedIds.sessionId,
        paymentIntentId: normalizedIds.paymentIntentId,
      });
    } catch (e) {
      const row: ReconciliationRow = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerEmail: order.customerEmail,
        ticketlyStatus: order.paymentStatus,
        stripeSessionStatus: null,
        stripeSessionPaymentStatus: null,
        stripePiStatus: null,
        amountMatch: null,
        currencyMatch: null,
        webhookLastSeenAt: lastWebhook?.receivedAt?.toISOString() ?? null,
        providerSessionId: payment?.providerSessionId ?? null,
        providerPaymentId: payment?.providerPaymentId ?? null,
        stripeDashboardUrl: stripeDashboardUrl({
          sessionId: normalizedIds.sessionId,
          paymentIntentId: normalizedIds.paymentIntentId,
        }),
        proposedAction: "none",
        anomalyReason: "LOOKUP_ERROR",
        applied: false,
        detail: e instanceof Error ? e.message.slice(0, 200) : "lookup_failed",
      };
      await writeAuditLog({
        organizationId: order.organizationId,
        action: "PAYMENT_RECONCILIATION_MISMATCH",
        entityType: "Order",
        entityId: order.id,
        metadata: {
          anomaly: "LOOKUP_ERROR",
          providerSessionId: payment?.providerSessionId ?? null,
          providerPaymentId: payment?.providerPaymentId ?? null,
        },
      });
      return row;
    }

    const decision = this.decide({
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

    if (apply && decision.action !== "none" && decision.action !== "verify_ok" && decision.action !== "skip_conflict") {
      try {
        const result = await this.applyDecision({
          orderId: order.id,
          organizationId: order.organizationId,
          paymentId: payment?.id,
          decision,
          lookup,
          actorId: opts.actorId,
        });
        applied = result.applied;
        detail = result.detail ?? detail;
      } catch (e) {
        // markOrderPaid may set REVIEW_REQUIRED on mismatch — surface as review
        detail = e instanceof Error ? e.message.slice(0, 200) : "apply_failed";
        await writeAuditLog({
          organizationId: order.organizationId,
          action: "PAYMENT_RECONCILIATION_MISMATCH",
          entityType: "Order",
          entityId: order.id,
          metadata: {
            anomaly: decision.anomaly,
            error: detail,
            providerSessionId: lookup.session?.id ?? null,
            providerPaymentId: lookup.paymentIntent?.id ?? null,
          },
        });
      }
    } else if (
      !apply &&
      decision.anomaly &&
      decision.action !== "verify_ok"
    ) {
      // Dry-run still records mismatch visibility for ops when requested? Skip to avoid noise.
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
      stripeSessionStatus: lookup.session?.status ?? null,
      stripeSessionPaymentStatus: lookup.session?.paymentStatus ?? null,
      stripePiStatus: lookup.paymentIntent?.status ?? null,
      amountMatch: decision.amountMatch,
      currencyMatch: decision.currencyMatch,
      webhookLastSeenAt: lastWebhook?.receivedAt?.toISOString() ?? null,
      providerSessionId: payment?.providerSessionId ?? lookup.session?.id ?? null,
      providerPaymentId:
        // Prefer real PI; do not surface legacy cs_… stored in providerPaymentId as a PI.
        lookup.paymentIntent?.id ??
        (payment?.providerPaymentId?.startsWith("pi_") ? payment.providerPaymentId : null) ??
        null,
      stripeDashboardUrl: stripeDashboardUrl({
        sessionId: normalizedIds.sessionId ?? lookup.session?.id,
        paymentIntentId: lookup.paymentIntent?.id ?? normalizedIds.paymentIntentId,
        livemode: lookup.paymentIntent?.livemode ?? lookup.session?.livemode,
      }),
      proposedAction: decision.action,
      anomalyReason: decision.anomaly,
      applied,
      detail,
    };
  }

  static async reconcile(opts: ReconcileOptions = {}): Promise<ReconcileResult> {
    const apply = !!opts.apply;
    const concurrency = opts.concurrency ?? 5;
    const filter = opts.filter ?? "all";
    const orders = await this.findCandidateOrders(opts);

    const rows = await mapWithConcurrency(orders, concurrency, async (order) =>
      this.reconcileOrder(order.id, opts)
    );

    const filtered = rows.filter((r) => matchesFilter(r, filter));
    const discrepancies = filtered.filter(
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
      rows: filtered,
    };
  }
}
