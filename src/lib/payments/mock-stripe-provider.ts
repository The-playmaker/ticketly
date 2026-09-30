import { PaymentProviderType, PaymentStatus } from "@prisma/client";
import { randomBytes } from "crypto";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookHandleResult,
} from "./types";

/**
 * Mock Stripe provider for local/demo without real Stripe keys.
 * Completes payment via /api/payments/mock/complete?sessionId=...
 * NEVER use in production with STRIPE_MOCK_MODE=false.
 */
export class MockStripePaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderType.STRIPE;

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const sessionId = `mock_cs_${randomBytes(12).toString("hex")}`;
    const base = process.env.APP_URL ?? "http://localhost:3456";
    const checkoutUrl = `${base}/api/payments/mock/complete?sessionId=${sessionId}&orderId=${input.orderId}&redirect=${encodeURIComponent(input.successUrl)}`;

    return {
      provider: PaymentProviderType.STRIPE,
      sessionId,
      checkoutUrl,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      providerRefundId: `mock_re_${randomBytes(8).toString("hex")}`,
      status: "SUCCEEDED",
      amount: input.amount,
    };
  }

  async parseWebhook(rawBody: string | Buffer, _signature: string | null): Promise<WebhookHandleResult> {
    const payload = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString());
    return {
      handled: true,
      type: payload.type ?? "mock.payment.completed",
      externalEventId: payload.id ?? `mock_evt_${randomBytes(8).toString("hex")}`,
      orderId: payload.orderId,
      paymentStatus: PaymentStatus.PAID,
      providerSessionId: payload.sessionId,
      providerPaymentId: payload.paymentId ?? payload.sessionId,
      amount: payload.amount,
      raw: payload,
    };
  }
}
