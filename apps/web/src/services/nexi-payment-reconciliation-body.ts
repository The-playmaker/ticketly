/**
 * Nets Easy (Nexi Checkout) ↔ Ticketly reconciliation.
 *
 * - Nexi GET /v1/payments/{paymentId} is authoritative for payment capture state
 * - Ticketly remains authoritative for order/ticket state
 * - Successful captures go through PaymentService.markOrderPaid (exactly-once)
 * - Never downgrades PAID on delayed failure / expired checkout
 *
 * Official API: https://developer.nexigroup.com/nexi-checkout/en-EU/api/payment-v1/
 */

import {
  PaymentProviderType,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  nexiPaymentIsCancelledOrExpired,
  nexiPaymentIsFailed,
  nexiPaymentIsPaid,
  type NexiLookupClient,
  type NexiOrderLookup,
} from "@/lib/payments/nexi-lookup";

const CANDIDATE_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.FAILED,
  PaymentStatus.REVIEW_REQUIRED,
  PaymentStatus.AUTHORIZED,
  PaymentStatus.PARTIALLY_REFUNDED,
];

export type NexiReconciliationAction =
  | "none"
  | "mark_paid"
  | "mark_failed"
  | "mark_cancelled"
  | "mark_review"
  | "sync_refunds"
  | "verify_ok"
  | "skip_conflict";

export type NexiReconciliationAnomaly =
  | null
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "ORDER_REFERENCE_MISMATCH"
  | "NEXI_PAID_TICKETLY_PENDING"
  | "NEXI_FAILED_TICKETLY_NOT_FAILED"
  | "REFUND_MISMATCH"
  | "LOOKUP_ERROR";

export type NexiReconciliationRow = {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  ticketlyStatus: PaymentStatus;
  nexiChargedAmount: number | null;
  nexiReservedAmount: number | null;
  nexiRefundedAmount: number | null;
  amountMatch: boolean | null;
  currencyMatch: boolean | null;
  providerPaymentId: string | null;
  providerChargeId: string | null;
  proposedAction: NexiReconciliationAction;
  anomalyReason: NexiReconciliationAnomaly;
  applied: boolean;
  detail?: string;
};

export type NexiReconcileOptions = {
  apply?: boolean;
  sinceHours?: number;
  paidVerifyHours?: number;
  orderId?: string;
  orderNumber?: string;
  limit?: number;
  concurrency?: number;
  nexiClient?: NexiLookupClient;
  actorId?: string;
};

export type NexiReconcileResult = {
  dryRun: boolean;
  scanned: number;
  applied: number;
  discrepancies: number;
  rows: NexiReconciliationRow[];
};

export class NexiPaymentReconciliationService {
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
    lookup: NexiOrderLookup;
  }): {
    action: NexiReconciliationAction;
    anomaly: NexiReconciliationAnomaly;
    amountMatch: boolean | null;
    currencyMatch: boolean | null;
    detail?: string;
    amount?: number;
    currency?: string;
  } {
    const { order, lookup, ticketlyRefunded } = input;
    const amountMatch =
      lookup.amount == null ? null : lookup.amount === order.total;
    const currencyMatch =
      lookup.currency == null
        ? null
        : lookup.currency === order.currency.toUpperCase();

    if (
      lookup.orderReference &&
      lookup.orderReference !== order.orderNumber &&
      lookup.myReference !== order.id
    ) {
      if (
        order.paymentStatus === PaymentStatus.PAID ||
        order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
        order.paymentStatus === PaymentStatus.REFUNDED
      ) {
        return {
          action: "skip_conflict",
          anomaly: "ORDER_REFERENCE_MISMATCH",
          amountMatch,
          currencyMatch,
          detail: "will_not_downgrade_paid",
        };
      }
      return {
        action: "mark_review",
        anomaly: "ORDER_REFERENCE_MISMATCH",
        amountMatch,
        currencyMatch,
      };
    }

    if (nexiPaymentIsPaid(lookup)) {
      if (amountMatch === false || currencyMatch === false) {
        if (
          order.paymentStatus === PaymentStatus.PAID ||
          order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
          order.paymentStatus === PaymentStatus.REFUNDED
        ) {
          return {
            action: "skip_conflict",
            anomaly: amountMatch === false ? "AMOUNT_MISMATCH" : "CURRENCY_MISMATCH",
            amountMatch,
            currencyMatch,
            detail: "will_not_downgrade_paid",
          };
        }
        return {
          action: "mark_review",
          anomaly: amountMatch === false ? "AMOUNT_MISMATCH" : "CURRENCY_MISMATCH",
          amountMatch,
          currencyMatch,
          amount: lookup.chargedAmount || lookup.amount || undefined,
          currency: lookup.currency ?? undefined,
        };
      }

      if (
        order.paymentStatus === PaymentStatus.PAID ||
        order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
        order.paymentStatus === PaymentStatus.REFUNDED
      ) {
        if (lookup.refundedAmount !== ticketlyRefunded) {
          return {
            action: "sync_refunds",
            anomaly: "REFUND_MISMATCH",
            amountMatch,
            currencyMatch,
          };
        }
        return {
          action: "verify_ok",
          anomaly: null,
          amountMatch: amountMatch ?? true,
          currencyMatch: currencyMatch ?? true,
        };
      }

      return {
        action: "mark_paid",
        anomaly: "NEXI_PAID_TICKETLY_PENDING",
        amountMatch: amountMatch ?? true,
        currencyMatch: currencyMatch ?? true,
        amount: lookup.chargedAmount || order.total,
        currency: lookup.currency ?? order.currency,
      };
    }

    if (nexiPaymentIsFailed(lookup) || nexiPaymentIsCancelledOrExpired(lookup)) {
      if (
        order.paymentStatus === PaymentStatus.PAID ||
        order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ||
        order.paymentStatus === PaymentStatus.REFUNDED
      ) {
        return {
          action: "skip_conflict",
          anomaly: "NEXI_FAILED_TICKETLY_NOT_FAILED",
          amountMatch,
          currencyMatch,
          detail: "will_not_downgrade_paid",
        };
      }
      if (
        order.paymentStatus === PaymentStatus.FAILED ||
        order.paymentStatus === PaymentStatus.CANCELLED
      ) {
        return {
          action: "none",
          anomaly: null,
          amountMatch,
          currencyMatch,
        };
      }
      const action: NexiReconciliationAction = nexiPaymentIsCancelledOrExpired(lookup)
        ? "mark_cancelled"
        : "mark_failed";
      return {
        action,
        anomaly: "NEXI_FAILED_TICKETLY_NOT_FAILED",
        amountMatch,
        currencyMatch,
      };
    }

    return {
      action: "none",
      anomaly: null,
      amountMatch,
      currencyMatch,
    };
  }

  static async findCandidateOrders(opts: NexiReconcileOptions = {}) {
    const sinceHours = opts.sinceHours ?? 24;
    const paidVerifyHours = opts.paidVerifyHours ?? sinceHours;
    const limit = opts.limit ?? 200;
    const paidSince = new Date(Date.now() - paidVerifyHours * 3600_000);
    const since = new Date(Date.now() - sinceHours * 3600_000);

    if (opts.orderId || opts.orderNumber) {
      return prisma.order.findMany({
        where: {
          ...(opts.orderId ? { id: opts.orderId } : {}),
          ...(opts.orderNumber ? { orderNumber: opts.orderNumber } : {}),
          payments: {
            some: {
              provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
            },
          },
        },
        include: {
          payments: {
            where: {
              provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
            },
            orderBy: { createdAt: "desc" },
          },
          refunds: true,
        },
        take: 1,
      });
    }

    return prisma.order.findMany({
      where: {
        payments: {
          some: {
            provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
          },
        },
        OR: [
          {
            paymentStatus: { in: CANDIDATE_STATUSES },
            createdAt: { gte: since },
          },
          {
            paymentStatus: PaymentStatus.PAID,
            paidAt: { gte: paidSince },
          },
        ],
      },
      include: {
        payments: {
          where: {
            provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
          },
          orderBy: { createdAt: "desc" },
        },
        refunds: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  static async reconcileOrder(
    orderId: string,
    opts: NexiReconcileOptions = {}
  ): Promise<NexiReconciliationRow> {
    const { nexiReconcileOrder } = await import("./nexi-payment-reconciliation-apply");
    return nexiReconcileOrder(this, orderId, opts);
  }

  static async reconcile(opts: NexiReconcileOptions = {}): Promise<NexiReconcileResult> {
    const { nexiReconcile } = await import("./nexi-payment-reconciliation-apply");
    return nexiReconcile(this, opts);
  }
}
