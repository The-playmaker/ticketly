import type { PaymentProviderType, PaymentStatus } from "@prisma/client";

export type CreateCheckoutInput = {
  orderId: string;
  orderNumber: string;
  amount: number; // øre
  currency: string;
  customerEmail: string;
  customerName: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
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
  amount: number; // øre
  currency: string;
  reason?: string;
  idempotencyKey?: string;
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
  paymentStatus?: PaymentStatus;
  providerPaymentId?: string;
  providerSessionId?: string;
  amount?: number;
  raw?: unknown;
};

/**
 * PaymentProvider — pluggable payment backend.
 * Stripe is first; Vipps MobilePay ePayment API can be added later
 * without changing OrderService.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderType;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  parseWebhook(rawBody: string | Buffer, signature: string | null): Promise<WebhookHandleResult>;
}
