/**
 * Nets Easy (Nexi Checkout) ↔ Ticketly reconciliation.
 * Official API: https://developer.nexigroup.com/nexi-checkout/en-EU/api/payment-v1/
 */

import { PaymentStatus } from "@prisma/client";
import {
  nexiPaymentIsCancelledOrExpired,
  nexiPaymentIsFailed,
  nexiPaymentIsPaid,
  type NexiOrderLookup,
} from "@/lib/payments/nexi-lookup";

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

  static async reconcile(opts: NexiReconcileOptions = {}): Promise<NexiReconcileResult> {
    void opts;
    // Full orchestration lands in follow-up commit (lookup + markOrderPaid apply path).
    return { dryRun: true, scanned: 0, applied: 0, discrepancies: 0, rows: [] };
  }
}
