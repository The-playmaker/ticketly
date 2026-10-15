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
 * Explicit mock provider for local/dev only.
 * Requires PAYMENT_PROVIDER=mock — never the production default.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderType.MOCK;

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const sessionId = `mock_pay_${randomBytes(12).toString("hex")}`;
    const base = process.env.APP_URL ?? "http://localhost:3456";
    const checkoutUrl = `${base}/api/payments/mock/complete?sessionId=${sessionId}&orderId=${input.orderId}&redirect=${encodeURIComponent(input.successUrl)}`;

    return {
      provider: PaymentProviderType.MOCK,
      sessionId,
      paymentId: sessionId,
      checkoutUrl,
      integrationType: "HostedPaymentPage",
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      providerRefundId: `mock_re_${randomBytes(8).toString("hex")}`,
      status: "SUCCEEDED",
      amount: input.amount,
    };
  }

  async parseWebhook(
    rawBody: string | Buffer,
    _signature: string | null
  ): Promise<WebhookHandleResult> {
    const payload = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString());
    return {
      handled: true,
      type: payload.type ?? payload.event ?? "mock.payment.completed",
      externalEventId: payload.id ?? `mock_evt_${randomBytes(8).toString("hex")}`,
      orderId: payload.orderId,
      paymentStatus: PaymentStatus.PAID,
      providerSessionId: payload.sessionId ?? payload.paymentId,
      providerPaymentId: payload.paymentId ?? payload.sessionId,
      amount: payload.amount,
      currency: payload.currency,
      paymentMethod: payload.paymentMethod,
      paymentType: payload.paymentType,
      raw: payload,
    };
  }

  async getHealth() {
    return { status: "operational" as const, message: "Mock provider (non-production)" };
  }
}
