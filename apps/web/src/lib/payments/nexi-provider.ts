import { PaymentProviderType, PaymentStatus } from "@prisma/client";
import {
  assertNexiConfiguredForRuntime,
  getNexiCheckoutKey,
  getNexiCheckoutScriptUrl,
  getNexiEnvironment,
  getNexiMerchantId,
  getNexiWebhookAuthorization,
  nexiConfigHealth,
} from "./nexi-config";
import { nexiRequest, sanitizeNexiLogPayload, NexiApiError } from "./nexi-client";
import {
  mapNexiEventToPaymentStatus,
  normalizeNexiPaymentMethod,
  parseNexiAmount,
} from "./nexi-status";
import type {
  CancelPaymentInput,
  CancelPaymentResult,
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookHandleResult,
} from "./types";

type CreatePaymentResponse = {
  paymentId: string;
  hostedPaymentPageUrl?: string;
  expiresAt?: string;
};

type RefundResponse = {
  refundId: string;
};

type RetrievePaymentResponse = {
  payment?: {
    paymentId?: string;
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
    charges?: Array<{ chargeId?: string; amount?: number }>;
  };
};

function splitPhone(phone?: string): { prefix: string; number: string } | undefined {
  if (!phone) return undefined;
  const cleaned = phone.replace(/[\s()-]/g, "");
  if (cleaned.startsWith("+47") && cleaned.length > 3) {
    return { prefix: "+47", number: cleaned.slice(3).replace(/\D/g, "") };
  }
  if (cleaned.startsWith("47") && cleaned.length >= 10) {
    return { prefix: "+47", number: cleaned.slice(2).replace(/\D/g, "") };
  }
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length >= 8) {
    return { prefix: "+47", number: digits.slice(-8) };
  }
  return undefined;
}

function sanitizeText(value: string, max = 128): string {
  return value.replace(/[<>'"`\\]/g, "").slice(0, max);
}

function buildOrderItems(input: CreateCheckoutInput) {
  if (input.items?.length) {
    return input.items.map((item) => ({
      reference: sanitizeText(item.reference),
      name: sanitizeText(item.name),
      quantity: item.quantity,
      unit: sanitizeText(item.unit || "pcs", 32),
      unitPrice: item.unitPrice,
      taxRate: item.taxRate ?? 0,
      taxAmount: item.taxAmount ?? 0,
      grossTotalAmount: item.grossTotalAmount,
      netTotalAmount: item.netTotalAmount,
    }));
  }

  // Single line fallback from order total (still server-calculated)
  return [
    {
      reference: sanitizeText(input.orderNumber),
      name: sanitizeText(input.description),
      quantity: 1,
      unit: "pcs",
      unitPrice: input.amount,
      taxRate: 0,
      taxAmount: 0,
      grossTotalAmount: input.amount,
      netTotalAmount: input.amount,
    },
  ];
}

function webhookUrl(): string {
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return `${appUrl}/api/payments/nexi/webhook`;
}

const WEBHOOK_EVENTS = [
  "payment.checkout.completed",
  "payment.reservation.created.v2",
  "payment.reservation.failed",
  "payment.charge.created.v2",
  "payment.charge.failed.v2",
  "payment.cancel.created",
  "payment.refund.completed",
  "payment.refund.failed",
  "payment.refund.initiated.v2",
] as const;

/**
 * Nexi Checkout (Nets Easy) PaymentProvider.
 *
 * Auth/capture: charge:true → authorize + capture immediately after reservation.
 * Event tickets have no shipping delay; immediate capture is the simplest safe flow.
 * See docs/PAYMENTS.md.
 */
export class NexiCheckoutProvider implements PaymentProvider {
  readonly name = PaymentProviderType.NEXI;

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    assertNexiConfiguredForRuntime();

    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new Error("Nexi amount must be a positive integer in minor units (øre)");
    }
    if (input.currency.toUpperCase() !== "NOK") {
      throw new Error(`Nexi production tickets require NOK (got ${input.currency})`);
    }

    const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
    const checkoutPageUrl =
      input.checkoutPageUrl ?? `${appUrl}/checkout/payment`;
    const termsUrl = input.termsUrl ?? `${appUrl}/terms`;
    const merchantTermsUrl = input.merchantTermsUrl ?? `${appUrl}/privacy`;
    const items = buildOrderItems(input);
    const itemsSum = items.reduce((s, i) => s + i.grossTotalAmount, 0);
    if (itemsSum !== input.amount) {
      throw new Error(
        `Nexi order items gross sum ${itemsSum} !== order amount ${input.amount}`
      );
    }

    const phone = splitPhone(input.customerPhone);
    const nameParts = input.customerName.trim().split(/\s+/);
    const firstName = sanitizeText(
      input.customerFirstName ?? nameParts[0] ?? "Kunde"
    );
    const lastName = sanitizeText(
      input.customerLastName ?? (nameParts.slice(1).join(" ") || "Kunde")
    );

    const authHeader = getNexiWebhookAuthorization();
    const payload = {
      order: {
        items,
        amount: input.amount,
        currency: "NOK",
        reference: sanitizeText(input.orderNumber),
      },
      checkout: {
        integrationType: "EmbeddedCheckout" as const,
        url: checkoutPageUrl,
        returnUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        termsUrl,
        merchantTermsUrl,
        merchantHandlesConsumerData: true,
        consumer: {
          reference: sanitizeText(input.orderId),
          email: input.customerEmail,
          ...(phone ? { phoneNumber: phone } : {}),
          privatePerson: { firstName, lastName },
        },
        charge: true,
        countryCode: "NOR",
        appearance: {
          displayOptions: {
            showMerchantName: false,
            showOrderSummary: false,
          },
        },
      },
      notifications: {
        webHooks: WEBHOOK_EVENTS.map((eventName) => ({
          eventName,
          url: webhookUrl(),
          authorization: authHeader,
        })),
      },
      myReference: sanitizeText(input.orderId),
      ...(getNexiMerchantId() ? { merchantNumber: getNexiMerchantId() } : {}),
    };

    let created: CreatePaymentResponse;
    try {
      created = await nexiRequest<CreatePaymentResponse>({
        method: "POST",
        path: "/v1/payments",
        body: payload,
        idempotencyKey: `create_${input.orderId}`.slice(0, 64),
      });
    } catch (e) {
      if (e instanceof NexiApiError) {
        console.error(
          "[nexi] create payment failed",
          e.status,
          sanitizeNexiLogPayload(e.body)
        );
      }
      throw e;
    }

    if (!created.paymentId) {
      throw new Error("Nexi did not return paymentId");
    }

    return {
      provider: PaymentProviderType.NEXI,
      sessionId: created.paymentId,
      paymentId: created.paymentId,
      checkoutKey: getNexiCheckoutKey(),
      checkoutScriptUrl: getNexiCheckoutScriptUrl(getNexiEnvironment()),
      integrationType: "EmbeddedCheckout",
      checkoutUrl: `${checkoutPageUrl}?paymentId=${encodeURIComponent(created.paymentId)}`,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    assertNexiConfiguredForRuntime();

    const chargeId = input.providerChargeId;
    if (!chargeId) {
      // Attempt to resolve charge from payment retrieve
      const payment = await this.retrievePayment(input.providerPaymentId);
      const fromCharges = payment.payment?.charges?.[0]?.chargeId;
      if (!fromCharges) {
        throw new Error(
          "Nexi refund requires providerChargeId (no charge found on payment)"
        );
      }
      return this.refundCharge(fromCharges, input);
    }
    return this.refundCharge(chargeId, input);
  }

  private async refundCharge(chargeId: string, input: RefundInput): Promise<RefundResult> {
    const body: Record<string, unknown> = { amount: input.amount };
    if (input.orderItems?.length) {
      body.orderItems = input.orderItems.map((item) => ({
        reference: sanitizeText(item.reference),
        name: sanitizeText(item.name),
        quantity: item.quantity,
        unit: item.unit || "pcs",
        unitPrice: item.unitPrice,
        taxRate: item.taxRate ?? 0,
        taxAmount: item.taxAmount ?? 0,
        grossTotalAmount: item.grossTotalAmount,
        netTotalAmount: item.netTotalAmount,
      }));
    }
    if (input.reason) {
      body.myReference = sanitizeText(input.reason, 64);
    }

    try {
      const result = await nexiRequest<RefundResponse>({
        method: "POST",
        path: `/v1/charges/${encodeURIComponent(chargeId)}/refunds`,
        body,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        providerRefundId: result.refundId,
        status: "PENDING", // confirmed via payment.refund.completed webhook
        amount: input.amount,
      };
    } catch (e) {
      if (e instanceof NexiApiError) {
        console.error("[nexi] refund failed", e.status, sanitizeNexiLogPayload(e.body));
      }
      throw e;
    }
  }

  async cancel(input: CancelPaymentInput): Promise<CancelPaymentResult> {
    assertNexiConfiguredForRuntime();
    try {
      await nexiRequest({
        method: "POST",
        path: `/v1/payments/${encodeURIComponent(input.providerPaymentId)}/cancels`,
        body: {},
      });
      return { cancelled: true, providerStatus: "cancelled" };
    } catch (e) {
      if (e instanceof NexiApiError) {
        console.error("[nexi] cancel failed", e.status, sanitizeNexiLogPayload(e.body));
      }
      throw e;
    }
  }

  async retrievePayment(paymentId: string): Promise<RetrievePaymentResponse> {
    return nexiRequest<RetrievePaymentResponse>({
      method: "GET",
      path: `/v1/payments/${encodeURIComponent(paymentId)}`,
    });
  }

  async parseWebhook(
    rawBody: string | Buffer,
    authorization: string | null
  ): Promise<WebhookHandleResult> {
    const expected = getNexiWebhookAuthorization();
    if (!authorization || authorization !== expected) {
      throw new Error("Invalid Nexi webhook Authorization header");
    }

    const payload = JSON.parse(
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
    ) as {
      id?: string;
      event?: string;
      data?: Record<string, unknown>;
      timestamp?: string;
    };

    if (!payload.id || !payload.event) {
      throw new Error("Malformed Nexi webhook payload");
    }

    const data = payload.data ?? {};
    const providerPaymentId =
      (typeof data.paymentId === "string" && data.paymentId) ||
      (typeof data.paymentid === "string" && data.paymentid) ||
      undefined;
    const providerChargeId =
      typeof data.chargeId === "string" ? data.chargeId : undefined;

    const { amount, currency } = parseNexiAmount(data);
    const orderRef =
      (data.order as { reference?: string } | undefined)?.reference ??
      (typeof data.merchantReference === "string" ? data.merchantReference : undefined);

    // myReference / order reference is our order number or order id
    let orderId: string | undefined;
    if (typeof data.myReference === "string" && data.myReference.startsWith("c")) {
      // cuid-like — treat as orderId when we stored orderId in myReference
      orderId = data.myReference;
    }

    const paymentMethodRaw =
      (data.paymentMethod as string | undefined) ??
      (data.paymentDetails as { paymentMethod?: string } | undefined)?.paymentMethod ??
      (data.cardDetails ? "CARD" : undefined) ??
      (typeof data.paymentType === "string" ? data.paymentType : undefined);

    // Vipps hints in payload
    const vippsHint =
      JSON.stringify(data).toLowerCase().includes("vipps") ? "VIPPS" : paymentMethodRaw;

    const methodMeta = normalizeNexiPaymentMethod(vippsHint);
    const paymentStatus = mapNexiEventToPaymentStatus(payload.event);

    return {
      handled: paymentStatus != null || payload.event.startsWith("payment."),
      type: payload.event,
      externalEventId: payload.id,
      orderId,
      paymentStatus: paymentStatus ?? undefined,
      providerPaymentId,
      providerSessionId: providerPaymentId,
      providerChargeId,
      amount,
      currency,
      paymentMethod: methodMeta.paymentMethod,
      paymentType: methodMeta.paymentType,
      providerStatus: payload.event,
      raw: {
        id: payload.id,
        event: payload.event,
        timestamp: payload.timestamp,
        paymentId: providerPaymentId,
        chargeId: providerChargeId,
        orderReference: orderRef,
        amount,
        currency,
        // Intentionally omit full consumer/card details from stored raw
      },
    };
  }

  async getHealth() {
    const health = nexiConfigHealth();
    return {
      status: health.status,
      message: health.message,
    };
  }
}

/** Helper for tests / verification after webhook */
export async function verifyNexiPaymentAmounts(
  paymentId: string,
  expectedAmount: number,
  expectedCurrency = "NOK"
): Promise<{ ok: boolean; reason?: string; chargedAmount?: number }> {
  const provider = new NexiCheckoutProvider();
  const res = await provider.retrievePayment(paymentId);
  const details = res.payment?.orderDetails;
  const summary = res.payment?.summary;
  const currency = details?.currency?.toUpperCase();
  const charged =
    summary?.chargedAmount ??
    details?.amount ??
    undefined;

  if (currency && currency !== expectedCurrency.toUpperCase()) {
    return { ok: false, reason: "PAYMENT_CURRENCY_MISMATCH", chargedAmount: charged };
  }
  if (charged != null && charged !== expectedAmount) {
    return { ok: false, reason: "PAYMENT_AMOUNT_MISMATCH", chargedAmount: charged };
  }
  return { ok: true, chargedAmount: charged };
}

export { PaymentStatus };
