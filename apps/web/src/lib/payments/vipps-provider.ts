import { PaymentProviderType } from "@prisma/client";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookHandleResult,
} from "./types";

/**
 * VippsPaymentProvider — STUB only.
 *
 * TODO: Implement official Vipps MobilePay ePayment API:
 * - https://developer.vippsmobilepay.com/docs/APIs/epayment-api/
 * - Create payment via POST /epayment/v1/payments
 * - Handle webhooks (AUTHORIZED, TERMINATED, ABORTED, EXPIRED)
 * - Capture / refund via ePayment endpoints
 * - Use Vipps access token (client credentials)
 *
 * Do NOT fake Vipps redirects or mock user flows here.
 * Keep OrderService unaware of Vipps specifics by implementing this interface.
 */
export class VippsPaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderType.VIPPS;

  async createCheckout(_input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    // TODO: Call Vipps MobilePay ePayment API create payment
    throw new Error(
      "Vipps MobilePay is not implemented yet. Use Stripe. See VippsPaymentProvider TODO."
    );
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    // TODO: Call Vipps refund endpoint
    throw new Error("Vipps refund is not implemented yet.");
  }

  async parseWebhook(
    _rawBody: string | Buffer,
    _signature: string | null
  ): Promise<WebhookHandleResult> {
    // TODO: Verify Vipps webhook signature and map event types
    throw new Error("Vipps webhook handling is not implemented yet.");
  }
}
