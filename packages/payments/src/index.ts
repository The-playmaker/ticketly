import type { SettlementBreakdown } from "@ticketly/shared-types";

/**
 * PaymentProvider — pluggable PSP.
 *
 * Production primary: Nexi Checkout (Nets Easy).
 * Stripe is optional/fallback. Vipps runs through Nexi when enabled on the merchant account.
 *
 * COMPLIANCE:
 * - Ticketly does NOT hold customer funds or organizer balances.
 * - Prefer marketplace / connected-account models where the licensed PSP settles
 *   to the seller of record.
 * - Application "balances" are reporting fields only.
 */

export type PaymentProviderType =
  | "NEXI"
  | "STRIPE"
  | "VIPPS"
  | "NETS"
  | "ADYEN"
  | "KLARNA"
  | "MOCK";

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
  connectedAccountId?: string;
  applicationFeeAmount?: number;
  metadata?: Record<string, string>;
};

export type CreateCheckoutResult = {
  provider: PaymentProviderType;
  sessionId: string;
  paymentId?: string;
  checkoutUrl?: string;
  checkoutKey?: string;
  checkoutScriptUrl?: string;
  integrationType?: "EmbeddedCheckout" | "HostedPaymentPage";
};

export type RefundInput = {
  providerPaymentId: string;
  providerChargeId?: string;
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
  paymentStatus?:
    | "PENDING"
    | "AUTHORIZED"
    | "PAID"
    | "FAILED"
    | "CANCELLED"
    | "REFUNDED"
    | "PARTIALLY_REFUNDED"
    | "REVIEW_REQUIRED";
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

/**
 * @deprecated Use Nexi Checkout with Vipps enabled on the merchant account.
 * Standalone Vipps ePayment is out of scope for first production launch.
 */
export class VippsPaymentProvider implements PaymentProvider {
  readonly name = "VIPPS" as const;

  async createCheckout(): Promise<CreateCheckoutResult> {
    throw new Error(
      "Standalone Vipps ePayment is not implemented. Enable Vipps on Nexi Checkout (PAYMENT_PROVIDER=nexi)."
    );
  }
  async refund(): Promise<RefundResult> {
    throw new Error("Vipps refund is not implemented — use Nexi Checkout refunds.");
  }
  async parseWebhook(): Promise<WebhookHandleResult> {
    throw new Error("Vipps webhook handling is not implemented — use Nexi webhooks.");
  }
}
