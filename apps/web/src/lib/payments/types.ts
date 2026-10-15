import type { PaymentProviderType, PaymentStatus } from "@prisma/client";

export type CheckoutOrderItem = {
  reference: string;
  name: string;
  quantity: number;
  unit: string;
  /** Unit price excluding VAT, in minor units (øre) */
  unitPrice: number;
  /** Tax rate in percentage × 100 (e.g. 2500 = 25%) */
  taxRate?: number;
  /** Total tax for the line, in minor units */
  taxAmount?: number;
  /** Gross total including VAT, in minor units */
  grossTotalAmount: number;
  /** Net total excluding VAT, in minor units */
  netTotalAmount: number;
};

export type CreateCheckoutInput = {
  orderId: string;
  orderNumber: string;
  amount: number; // øre / minor units
  currency: string;
  customerEmail: string;
  customerName: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerPhone?: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  /** Exact URL of the page that embeds Nexi Checkout.js */
  checkoutPageUrl?: string;
  termsUrl?: string;
  merchantTermsUrl?: string;
  items?: CheckoutOrderItem[];
  metadata?: Record<string, string>;
};

export type CreateCheckoutResult = {
  provider: PaymentProviderType;
  sessionId: string;
  paymentId?: string;
  /** Hosted redirect URL when not using embedded checkout */
  checkoutUrl?: string;
  /** Client-safe checkout key for EmbeddedCheckout */
  checkoutKey?: string;
  /** Script URL for Checkout.js (test vs production) */
  checkoutScriptUrl?: string;
  integrationType?: "EmbeddedCheckout" | "HostedPaymentPage";
};

export type RefundInput = {
  providerPaymentId: string;
  /** Required for Nexi charge-based refunds */
  providerChargeId?: string;
  amount: number; // øre
  currency: string;
  reason?: string;
  idempotencyKey?: string;
  orderItems?: CheckoutOrderItem[];
};

export type RefundResult = {
  providerRefundId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  amount: number;
};

export type CancelPaymentInput = {
  providerPaymentId: string;
  reason?: string;
};

export type CancelPaymentResult = {
  cancelled: boolean;
  providerStatus?: string;
};

export type WebhookHandleResult = {
  handled: boolean;
  type: string;
  externalEventId: string;
  orderId?: string;
  paymentStatus?: PaymentStatus;
  providerPaymentId?: string;
  providerSessionId?: string;
  providerChargeId?: string;
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  paymentType?: string;
  providerStatus?: string;
  raw?: unknown;
};

/**
 * PaymentProvider — pluggable payment backend.
 * Production default: Nexi Checkout (Nets Easy).
 * Stripe remains optional/fallback. Vipps runs through Nexi when enabled on the merchant.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderType;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  cancel?(input: CancelPaymentInput): Promise<CancelPaymentResult>;
  parseWebhook(rawBody: string | Buffer, signature: string | null): Promise<WebhookHandleResult>;
  /** Optional safe config/health check — no expensive payment API calls */
  getHealth?(): Promise<{
    status: "operational" | "configuration_error" | "webhook_error";
    message?: string;
  }>;
}
