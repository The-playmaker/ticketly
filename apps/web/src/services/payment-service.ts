import {
  PaymentProviderType,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPaymentProvider, isStripeMockMode } from "@/lib/payments";
import { TicketService } from "@/services/ticket-service";
import { writeAuditLog } from "@/lib/audit";
import { createOrderSnapshot } from "@ticketly/ticketing";
import { AppError } from "@/lib/api-error";

export class PaymentService {
  static assertMockAllowed() {
    if (isStripeMockMode()) {
      if (process.env.NODE_ENV === "production") {
        throw new AppError(
          "MOCK_PAYMENTS_DISABLED",
          "Mock payments are forbidden in production",
          403
        );
      }
    }
  }

  static async startCheckout(orderId: string, providerType: PaymentProviderType = PaymentProviderType.STRIPE) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { event: true, items: { include: { ticketType: true } } },
    });

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new AppError("ORDER_ALREADY_PAID", "Ordren er allerede betalt", 409);
    }
    if (order.paymentAnomaly) {
      throw new AppError("PAYMENT_ANOMALY", "Ordren er sperret for manuell gjennomgang", 409);
    }

    // Free orders: only if every ticket type is publicly purchasable at zero
    if (order.total === 0) {
      const allPublic = order.items.every((i) => i.ticketType.isPubliclyPurchasable);
      if (!allPublic) {
        throw new AppError(
          "FREE_TICKET_NOT_PUBLIC",
          "Gratisbilletter kan ikke kjøpes offentlig",
          403
        );
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
      };
    }

    if (isStripeMockMode()) {
      this.assertMockAllowed();
    }

    const provider = getPaymentProvider(providerType);
    const appUrl = process.env.APP_URL ?? "http://localhost:3456";

    const result = await provider.createCheckout({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: order.total,
      currency: order.currency,
      customerEmail: order.customerEmail,
      customerName: `${order.customerFirstName} ${order.customerLastName}`,
      description: `${order.event.name} – ${order.orderNumber}`,
      successUrl: `${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}&checkout=success`,
      cancelUrl: `${appUrl}/checkout?event=${order.event.slug}&cancelled=1`,
      metadata: { eventId: order.eventId },
    });

    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: providerType,
        providerSessionId: result.sessionId,
        providerPaymentId: result.paymentId,
        amount: order.total,
        currency: order.currency,
        status: PaymentStatus.PENDING,
        idempotencyKey: `checkout_${order.id}_${result.sessionId}`,
      },
    });

    return result;
  }

  static async handleProviderWebhook(input: {
    provider: PaymentProviderType;
    rawBody: string | Buffer;
    signature: string | null;
  }) {
    if (isStripeMockMode() && input.signature === "mock") {
      this.assertMockAllowed();
    }

    const provider = getPaymentProvider(input.provider);
    const parsed = await provider.parseWebhook(input.rawBody, input.signature);

    const existingWebhook = await prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: input.provider,
          eventId: parsed.externalEventId,
        },
      },
    });
    if (existingWebhook) {
      return { duplicate: true, type: parsed.type };
    }

    try {
      await prisma.webhookEvent.create({
        data: {
          provider: input.provider,
          eventId: parsed.externalEventId,
          eventType: parsed.type,
          payload: (parsed.raw as object) ?? {},
          processedAt: new Date(),
        },
      });
    } catch {
      // Race: another worker inserted the same event id
      return { duplicate: true, type: parsed.type };
    }

    if (!parsed.handled) {
      return { duplicate: false, type: parsed.type, skipped: true };
    }

    if (
      parsed.paymentStatus === PaymentStatus.PAID &&
      (parsed.orderId || parsed.providerSessionId)
    ) {
      let orderId = parsed.orderId;
      if (!orderId && parsed.providerSessionId) {
        const payment = await prisma.payment.findFirst({
          where: { providerSessionId: parsed.providerSessionId },
        });
        orderId = payment?.orderId;
      }

      if (orderId) {
        await this.markOrderPaid({
          orderId,
          provider: input.provider,
          providerSessionId: parsed.providerSessionId,
          providerPaymentId: parsed.providerPaymentId,
          externalEventId: parsed.externalEventId,
          amount: parsed.amount,
          currency: parsed.currency,
        });
      }
    }

    if (parsed.paymentStatus === PaymentStatus.FAILED && parsed.orderId) {
      await prisma.order.update({
        where: { id: parsed.orderId },
        data: { paymentStatus: PaymentStatus.FAILED },
      });
    }

    if (
      (parsed.paymentStatus === PaymentStatus.REFUNDED ||
        parsed.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED) &&
      parsed.providerPaymentId
    ) {
      const payment = await prisma.payment.findFirst({
        where: { providerPaymentId: parsed.providerPaymentId },
      });
      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: parsed.paymentStatus },
        });
      }
    }

    return { duplicate: false, type: parsed.type, orderId: parsed.orderId };
  }

  static async markOrderPaid(input: {
    orderId: string;
    provider: PaymentProviderType;
    providerSessionId?: string;
    providerPaymentId?: string;
    externalEventId?: string;
    amount?: number;
    currency?: string;
  }) {
    const order = await prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new AppError("ORDER_NOT_FOUND", "Order not found", 404);

    if (order.paymentStatus === PaymentStatus.PAID && !order.paymentAnomaly) {
      await TicketService.issueTicketsForPaidOrder(order.id);
      return order;
    }

    // Amount / currency integrity — never issue tickets on mismatch
    if (input.amount != null && input.amount !== order.total) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentAnomaly: true,
          paymentAnomalyReason: `AMOUNT_MISMATCH expected=${order.total} got=${input.amount}`,
        },
      });
      await writeAuditLog({
        action: "PAYMENT_ANOMALY",
        entityType: "Order",
        entityId: order.id,
        organizationId: order.organizationId,
        metadata: {
          reason: "AMOUNT_MISMATCH",
          expected: order.total,
          got: input.amount,
          externalEventId: input.externalEventId,
        },
      });
      throw new AppError("PAYMENT_AMOUNT_MISMATCH", "Betalingsbeløp matcher ikke ordre", 409);
    }

    if (input.currency && input.currency.toUpperCase() !== order.currency.toUpperCase()) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentAnomaly: true,
          paymentAnomalyReason: `CURRENCY_MISMATCH expected=${order.currency} got=${input.currency}`,
        },
      });
      await writeAuditLog({
        action: "PAYMENT_ANOMALY",
        entityType: "Order",
        entityId: order.id,
        organizationId: order.organizationId,
        metadata: { reason: "CURRENCY_MISMATCH", expected: order.currency, got: input.currency },
      });
      throw new AppError("PAYMENT_CURRENCY_MISMATCH", "Valuta matcher ikke ordre", 409);
    }

    if (order.paymentAnomaly) {
      throw new AppError("PAYMENT_ANOMALY", "Ordren er sperret", 409);
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          paidAt: new Date(),
        },
      });

      const existing = await tx.payment.findFirst({
        where: {
          orderId: order.id,
          OR: [
            input.providerSessionId ? { providerSessionId: input.providerSessionId } : undefined,
            input.providerPaymentId ? { providerPaymentId: input.providerPaymentId } : undefined,
          ].filter(Boolean) as object[],
        },
      });

      if (existing) {
        await tx.payment.update({
          where: { id: existing.id },
          data: {
            status: PaymentStatus.PAID,
            providerPaymentId: input.providerPaymentId ?? existing.providerPaymentId,
            providerSessionId: input.providerSessionId ?? existing.providerSessionId,
          },
        });
      } else {
        await tx.payment.create({
          data: {
            orderId: order.id,
            provider: input.provider,
            providerSessionId: input.providerSessionId,
            providerPaymentId: input.providerPaymentId,
            amount: input.amount ?? order.total,
            currency: order.currency,
            status: PaymentStatus.PAID,
            idempotencyKey: input.externalEventId
              ? `paid_${input.externalEventId}`
              : `paid_${order.id}_${Date.now()}`,
          },
        });
      }
    });

    await TicketService.issueTicketsForPaidOrder(order.id);
    try {
      await createOrderSnapshot(order.id);
    } catch (e) {
      console.error("OrderSnapshot failed", e);
    }
    return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }
}
