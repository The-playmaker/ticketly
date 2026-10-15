import { PaymentStatus } from "@prisma/client";

/**
 * Map Nexi webhook event names / raw statuses → Ticketly PaymentStatus.
 * Raw provider status is stored separately on Payment.providerStatus.
 */
export function mapNexiEventToPaymentStatus(eventName: string): PaymentStatus | null {
  switch (eventName) {
    case "payment.checkout.completed":
    case "payment.charge.created":
    case "payment.charge.created.v2":
      return PaymentStatus.PAID;
    case "payment.reservation.created":
    case "payment.reservation.created.v2":
      return PaymentStatus.AUTHORIZED;
    case "payment.reservation.failed":
    case "payment.charge.failed":
    case "payment.charge.failed.v2":
      return PaymentStatus.FAILED;
    case "payment.cancel.created":
      return PaymentStatus.CANCELLED;
    case "payment.refund.completed":
      return PaymentStatus.REFUNDED;
    case "payment.refund.initiated":
    case "payment.refund.initiated.v2":
      return PaymentStatus.PARTIALLY_REFUNDED;
    case "payment.refund.failed":
      return null; // do not flip domain status on failed refund
    default:
      return null;
  }
}

/**
 * Normalize Nexi payment method strings to Ticketly metadata.
 * Vipps through Nexi Checkout → paymentMethod=VIPPS, paymentType=WALLET.
 */
export function normalizeNexiPaymentMethod(raw?: string | null): {
  paymentMethod?: string;
  paymentType?: string;
} {
  if (!raw) return {};
  const upper = raw.toUpperCase().replace(/[\s_-]+/g, "");
  if (upper.includes("VIPPS")) {
    return { paymentMethod: "VIPPS", paymentType: "WALLET" };
  }
  if (upper.includes("APPLEPAY") || upper === "APPLE") {
    return { paymentMethod: "APPLEPAY", paymentType: "WALLET" };
  }
  if (upper.includes("GOOGLEPAY") || upper === "GOOGLE") {
    return { paymentMethod: "GOOGLEPAY", paymentType: "WALLET" };
  }
  if (upper.includes("VISA")) {
    return { paymentMethod: "VISA", paymentType: "CARD" };
  }
  if (upper.includes("MASTERCARD") || upper.includes("MASTER")) {
    return { paymentMethod: "MASTERCARD", paymentType: "CARD" };
  }
  if (upper.includes("CARD") || upper.includes("CREDIT") || upper.includes("DEBIT")) {
    return { paymentMethod: "CARD", paymentType: "CARD" };
  }
  return { paymentMethod: upper.slice(0, 32), paymentType: "OTHER" };
}

/** Parse Nexi amount fields that may arrive as string or nested { amount, currency }. */
export function parseNexiAmount(
  data: Record<string, unknown> | undefined
): { amount?: number; currency?: string } {
  if (!data) return {};
  const order = data.order as Record<string, unknown> | undefined;
  const amountObj =
    (data.amount as Record<string, unknown> | undefined) ??
    (order?.amount as Record<string, unknown> | undefined);

  if (amountObj && typeof amountObj === "object") {
    const raw = amountObj.amount;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    const currency =
      typeof amountObj.currency === "string" ? amountObj.currency : undefined;
    return {
      amount: Number.isFinite(n) ? n : undefined,
      currency,
    };
  }

  if (typeof data.amount === "number") {
    return { amount: data.amount };
  }
  if (typeof data.amount === "string") {
    const n = Number(data.amount);
    return { amount: Number.isFinite(n) ? n : undefined };
  }
  return {};
}
