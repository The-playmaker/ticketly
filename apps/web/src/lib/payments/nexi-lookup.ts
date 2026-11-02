/**
 * Nets Easy / Nexi Checkout payment lookup for reconciliation.
 * Uses official GET /v1/payments/{paymentId} (Payment API).
 * Source: https://developer.nexigroup.com/nexi-checkout/en-EU/api/payment-v1/
 */

import { NexiCheckoutProvider } from "./nexi-provider";
import { nexiRequest } from "./nexi-client";

export type NexiRefundSnapshot = {
  id: string;
  amount: number;
  status: "Pending" | "Cancelled" | "Failed" | "Completed" | "Expired" | string;
};

export type NexiOrderLookup = {
  paymentId: string;
  amount: number | null;
  currency: string | null;
  orderReference: string | null;
  myReference: string | null;
  chargedAmount: number;
  reservedAmount: number;
  refundedAmount: number;
  cancelledAmount: number;
  chargeId: string | null;
  paymentMethod: string | null;
  paymentType: string | null;
  checkoutExpiresAt: string | null;
  terminatedAt: string | null;
  refunds: NexiRefundSnapshot[];
  rawSummary: Record<string, number | undefined>;
};

export type NexiLookupClient = {
  retrieve(paymentId: string): Promise<NexiOrderLookup>;
};

type RetrievePaymentResponse = {
  payment?: {
    paymentId?: string;
    myReference?: string;
    terminated?: string;
    orderDetails?: { amount?: number; currency?: string; reference?: string };
    summary?: {
      reservedAmount?: number;
      chargedAmount?: number;
      refundedAmount?: number;
      cancelledAmount?: number;
    };
    paymentDetails?: {
      paymentMethod?: string;
      paymentType?: string;
    };
    checkout?: { expiresAt?: string; url?: string };
    charges?: Array<{ chargeId?: string; amount?: number }>;
    refunds?: Array<{
      refundId?: string;
      amount?: number;
      state?: string;
    }>;
  };
};

function mapRetrieve(res: RetrievePaymentResponse, paymentId: string): NexiOrderLookup {
  const p = res.payment;
  const summary = p?.summary ?? {};
  return {
    paymentId: p?.paymentId ?? paymentId,
    amount: p?.orderDetails?.amount ?? null,
    currency: p?.orderDetails?.currency?.toUpperCase() ?? null,
    orderReference: p?.orderDetails?.reference ?? null,
    myReference: p?.myReference ?? null,
    chargedAmount: summary.chargedAmount ?? 0,
    reservedAmount: summary.reservedAmount ?? 0,
    refundedAmount: summary.refundedAmount ?? 0,
    cancelledAmount: summary.cancelledAmount ?? 0,
    chargeId: p?.charges?.[0]?.chargeId ?? null,
    paymentMethod: p?.paymentDetails?.paymentMethod ?? null,
    paymentType: p?.paymentDetails?.paymentType ?? null,
    checkoutExpiresAt: p?.checkout?.expiresAt ?? null,
    terminatedAt: p?.terminated ?? null,
    refunds: (p?.refunds ?? [])
      .filter((r) => r.refundId)
      .map((r) => ({
        id: r.refundId!,
        amount: r.amount ?? 0,
        status: r.state ?? "Pending",
      })),
    rawSummary: {
      reservedAmount: summary.reservedAmount,
      chargedAmount: summary.chargedAmount,
      refundedAmount: summary.refundedAmount,
      cancelledAmount: summary.cancelledAmount,
    },
  };
}

export function createLiveNexiLookupClient(): NexiLookupClient {
  return {
    async retrieve(paymentId: string) {
      const res = await nexiRequest<RetrievePaymentResponse>({
        method: "GET",
        path: `/v1/payments/${encodeURIComponent(paymentId)}`,
      });
      return mapRetrieve(res, paymentId);
    },
  };
}

/** Test/helper: wrap provider retrievePayment */
export async function lookupNexiForPayment(
  paymentId: string,
  client?: NexiLookupClient
): Promise<NexiOrderLookup> {
  if (client) return client.retrieve(paymentId);
  const provider = new NexiCheckoutProvider();
  const res = await provider.retrievePayment(paymentId);
  return mapRetrieve(res as RetrievePaymentResponse, paymentId);
}

export function nexiPaymentIsPaid(lookup: NexiOrderLookup, expectedAmount?: number): boolean {
  if (lookup.chargedAmount <= 0) return false;
  if (expectedAmount != null && lookup.chargedAmount < expectedAmount) return false;
  return true;
}

export function nexiPaymentIsFailed(lookup: NexiOrderLookup): boolean {
  if (nexiPaymentIsPaid(lookup)) return false;
  // Terminated without charge, or fully cancelled with no charge
  if (lookup.terminatedAt && lookup.chargedAmount === 0) return true;
  if (lookup.cancelledAmount > 0 && lookup.chargedAmount === 0 && lookup.reservedAmount === 0) {
    return true;
  }
  return false;
}

export function nexiPaymentIsCancelledOrExpired(lookup: NexiOrderLookup, now = new Date()): boolean {
  if (nexiPaymentIsPaid(lookup)) return false;
  if (lookup.terminatedAt) return true;
  if (lookup.cancelledAmount > 0 && lookup.chargedAmount === 0) return true;
  if (lookup.checkoutExpiresAt) {
    const exp = new Date(lookup.checkoutExpiresAt);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() < now.getTime() && lookup.chargedAmount === 0) {
      return true;
    }
  }
  return false;
}
