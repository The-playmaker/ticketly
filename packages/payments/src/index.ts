import type { SettlementBreakdown } from "@ticketly/shared-types";

/**
 * PaymentProvider — pluggable PSP.
 *
 * COMPLIANCE:
 * - Ticketly does NOT hold customer funds or organizer balances.
 * - Prefer marketplace / connected-account models (e.g. Stripe Connect)
 *   where the licensed PSP settles to the seller of record.
 * - Application "balances" are reporting fields only.
 */

export type PaymentProviderType = "STRIPE" | "VIPPS" | "NETS" | "ADYEN" | "KLARNA";

export type CreateCheckoutInput = {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  /** Connected account for seller-of-record settlement when using marketplace mode */
  connectedAccountId?: string;
  applicationFeeAmount?: number;
  metadata?: Record<string, string>;
};

export type CreateCheckoutResult = {
  provider: PaymentProviderType;
  sessionId: string;
  paymentId?: string;
  checkoutUrl: string;
};

export type RefundInput = {
  providerPaymentId: string;
  amount: number;
  currency: string;
  reason?: string;
  idempotencyKey?: string;
  connectedAccountId?: string;
};

export type RefundResult = {
  providerRefundId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amount: number;
};

export type WebhookHandleResult = {
  handled: boolean;
  type: string;
  externalEventId: string;
  orderId?: string;
  paymentStatus?: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  providerPaymentId?: string;
  providerSessionId?: string;
  amount?: number;
  raw?: unknown;
};

export interface PaymentProvider {
  readonly name: PaymentProviderType;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  parseWebhook(rawBody: string | Buffer, signature: string | null): Promise<WebhookHandleResult>;
}

/** Split amounts for reporting — does not move money outside the PSP. */
export function computeSettlementBreakdown(input: {
  grossTicketOre: number;
  platformFeeOre: number;
  paymentProcessingFeeOre: number;
  taxOre: number;
  refundOre?: number;
}): SettlementBreakdown {
  const refund = input.refundOre ?? 0;
  return {
    grossTicketAmountOre: input.grossTicketOre,
    platformFeeOre: input.platformFeeOre,
    paymentProcessingFeeOre: input.paymentProcessingFeeOre,
    taxOre: input.taxOre,
    organizerAmountOre: Math.max(
      0,
      input.grossTicketOre - input.platformFeeOre - input.paymentProcessingFeeOre - refund
    ),
    refundOre: refund,
  };
}

export class VippsPaymentProvider implements PaymentProvider {
  readonly name = "VIPPS" as const;

  async createCheckout(): Promise<CreateCheckoutResult> {
    // TODO: Vipps MobilePay ePayment API — do not fake redirects
    throw new Error("Vipps MobilePay is not implemented. Use Stripe / licensed PSP.");
  }
  async refund(): Promise<RefundResult> {
    throw new Error("Vipps refund is not implemented yet.");
  }
  async parseWebhook(): Promise<WebhookHandleResult> {
    throw new Error("Vipps webhook handling is not implemented yet.");
  }
}
