import {
  PaymentProviderType,
  PaymentStatus,
  WebhookProcessStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getPaymentProvider,
  isMockPaymentMode,
  resolvePaymentProviderType,
} from "@/lib/payments";
import {
  PAID_LIKE,
  reconcileExistingAttemptBeforeNewCheckout,
  createCheckoutWithOptionalFailover,
} from "@/services/payment-checkout-attempt";
import { AppError } from "@/lib/api-error";
import { markOrderPaidImpl } from "@/services/payment-service-paid";
import {
  handleProviderWebhookImpl,
  replayWebhookEventImpl,
} from "@/services/payment-service-webhook";

function buildCheckoutItems(
  items: Array<{
    ticketTypeId: string;
    quantity: number;
    unitPrice: number;
    serviceFee: number;
    tax: number;
    total: number;
    name: string;
  }>,
  serviceFeeTotal: number
) {
  const lines = items.map((item) => {
    const net = item.unitPrice * item.quantity;
    const tax = item.tax;
    const gross = item.total - item.serviceFee;
    return {
      reference: item.ticketTypeId,
      name: item.name,
      quantity: item.quantity,
      unit: "pcs",
      unitPrice: item.unitPrice,
      taxRate: 0,
      taxAmount: tax,
      grossTotalAmount: gross > 0 ? gross : item.unitPrice * item.quantity + tax,
      netTotalAmount: net,
    };
  });
  if (serviceFeeTotal > 0) {
    lines.push({
      reference: "service-fee",
      name: "Serviceavgift",
      quantity: 1,
      unit: "pcs",
      unitPrice: serviceFeeTotal,
      taxRate: 0,
      taxAmount: 0,
      grossTotalAmount: serviceFeeTotal,
      netTotalAmount: serviceFeeTotal,
    });
  }
  return lines;
}

export class PaymentService {
  static assertMockAllowed() {
    if (isMockPaymentMode() && process.env.NODE_ENV === "production") {
      throw new AppError("MOCK_PAYMENTS_DISABLED", "Mock payments are forbidden in production", 403);
    }
  }

  static async startCheckout(
    orderId: string,
    providerType: PaymentProviderType = resolvePaymentProviderType()
  ) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { event: true, items: { include: { ticketType: true } } },
    });
    if (PAID_LIKE.includes(order.paymentStatus)) {
      throw new AppError("ORDER_ALREADY_PAID", "Ordren er allerede betalt", 409);
    }
    if (order.paymentStatus === PaymentStatus.REVIEW_REQUIRED || order.paymentAnomaly) {
      throw new AppError("PAYMENT_ANOMALY", "Ordren er sperret for manuell gjennomgang", 409);
    }
    if (order.total === 0) {
      const allPublic = order.items.every((i) => i.ticketType.isPubliclyPurchasable);
      if (!allPublic) {
        throw new AppError("FREE_TICKET_NOT_PUBLIC", "Gratisbilletter kan ikke kjøpes offentlig", 403);
      }
      await this.markOrderPaid({
        orderId: order.id,
        provider: providerType,
        providerSessionId: `free_${order.id}`,
        providerPaymentId: `free_${order.id}`,
        externalEventId: `free_${order.id}`,
        amount: 0,
        currency: order.currency,
      });
      const appUrl = process.env.APP_URL ?? "http://localhost:3456";
      return {
        checkoutUrl: `${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}&paid=1`,
        sessionId: `free_${order.id}`,
        paymentId: `free_${order.id}`,
        provider: providerType,
        integrationType: "HostedPaymentPage" as const,
        orderNumber: order.orderNumber,
        accessToken: order.accessToken,
      };
    }
    const precheck = await reconcileExistingAttemptBeforeNewCheckout(order.id, (input) =>
      this.markOrderPaid(input)
    );
    if (precheck.reuse) return precheck.reuse;
    const attemptNumber = precheck.attemptNumber;
    if (providerType === PaymentProviderType.MOCK || isMockPaymentMode()) this.assertMockAllowed();
    if (process.env.NODE_ENV === "production" && providerType === PaymentProviderType.MOCK) {
      throw new AppError("PAYMENT_CONFIG_ERROR", "Betaling er ikke konfigurert for produksjon", 503);
    }
    const appUrl = (process.env.APP_URL ?? "http://localhost:3456").replace(/\/$/, "");
    const checkoutPageUrl = `${appUrl}/checkout/payment`;
    const items = buildCheckoutItems(order.items, order.serviceFee);
    const sum = items.reduce((s, i) => s + i.grossTotalAmount, 0);
    if (sum !== order.total && items.length > 0) {
      const delta = order.total - sum;
      const last = items[items.length - 1]!;
      last.grossTotalAmount += delta;
      last.netTotalAmount += delta;
      last.unitPrice = Math.round(last.netTotalAmount / Math.max(1, last.quantity));
    }
    const result = await createCheckoutWithOptionalFailover({
      orderId: order.id,
      organizationId: order.organizationId,
      providerType,
      attemptNumber,
      checkoutInput: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount: order.total,
        currency: order.currency,
        customerEmail: order.customerEmail,
        customerName: `${order.customerFirstName} ${order.customerLastName}`,
        customerFirstName: order.customerFirstName,
        customerLastName: order.customerLastName,
        customerPhone: order.customerPhone ?? undefined,
        description: `${order.event.name} – ${order.orderNumber}`,
        successUrl: `${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}&checkout=success`,
        cancelUrl: `${appUrl}/checkout?event=${order.event.slug}&cancelled=1`,
        checkoutPageUrl,
        termsUrl: `${appUrl}/terms`,
        merchantTermsUrl: `${appUrl}/privacy`,
        items,
        metadata: { eventId: order.eventId, attempt: String(attemptNumber) },
        idempotencyKey: `create_${order.id}_a${attemptNumber}`.slice(0, 64),
      },
    });
    const usedProvider = result.usedProvider;
    const providerPaymentId =
      usedProvider === PaymentProviderType.STRIPE
        ? result.paymentId && result.paymentId.startsWith("pi_")
          ? result.paymentId
          : null
        : (result.paymentId ?? result.sessionId);
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: usedProvider,
        providerSessionId: result.sessionId,
        providerPaymentId,
        amount: order.total,
        currency: order.currency,
        status: PaymentStatus.PENDING,
        providerStatus: result.failoverFrom ? "created_via_failover" : "created",
        idempotencyKey: `checkout_${order.id}_${result.sessionId}`,
        providerMetadata: {
          integrationType: result.integrationType ?? null,
          attemptNumber: result.attemptNumber,
          failoverFrom: result.failoverFrom,
          failoverReason: result.failoverReason,
        },
      },
    });
    return {
      ...result,
      provider: usedProvider,
      checkoutUrl:
        result.checkoutUrl ??
        `${checkoutPageUrl}?paymentId=${encodeURIComponent(result.paymentId ?? result.sessionId)}&orderNumber=${encodeURIComponent(order.orderNumber)}&t=${encodeURIComponent(order.accessToken)}`,
      orderNumber: order.orderNumber,
      accessToken: order.accessToken,
    };
  }

  static handleProviderWebhook = handleProviderWebhookImpl;
  static replayWebhookEvent = replayWebhookEventImpl;
  static markOrderPaid = markOrderPaidImpl;
}
