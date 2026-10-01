import {
  PaymentProviderType,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { TicketService } from "@/services/ticket-service";

export class PaymentService {
  static async startCheckout(orderId: string, providerType: PaymentProviderType = PaymentProviderType.STRIPE) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { event: true },
    });

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new Error("Ordren er allerede betalt");
    }

    // Free / guest-list style orders
    if (order.total === 0) {
      await this.markOrderPaid({
        orderId: order.id,
        provider: providerType,
        providerSessionId: `free_${order.id}`,
        providerPaymentId: `free_${order.id}`,
        externalEventId: `free_${order.id}`,
      });
      const appUrl = process.env.APP_URL ?? "http://localhost:3456";
      return {
        checkoutUrl: `${appUrl}/orders/${order.orderNumber}?paid=1`,
        sessionId: `free_${order.id}`,
      };
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
      successUrl: `${appUrl}/orders/${order.orderNumber}?checkout=success`,
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

  /**
   * Idempotent webhook processing. Never trust frontend redirect for payment success.
   */
  static async handleProviderWebhook(input: {
    provider: PaymentProviderType;
    rawBody: string | Buffer;
    signature: string | null;
  }) {
    const provider = getPaymentProvider(input.provider);
    const parsed = await provider.parseWebhook(input.rawBody, input.signature);

    // Idempotency via WebhookEvent unique (provider, eventId)
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
      // Duplicate webhook — already processed
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
        });
      }
    }

    if (parsed.paymentStatus === PaymentStatus.FAILED && parsed.orderId) {
      await prisma.order.update({
        where: { id: parsed.orderId },
        data: { paymentStatus: PaymentStatus.FAILED },
      });
      if (parsed.providerPaymentId) {
        await prisma.payment.updateMany({
          where: {
            OR: [
              { providerPaymentId: parsed.providerPaymentId },
              { orderId: parsed.orderId },
            ],
          },
          data: { status: PaymentStatus.FAILED },
        });
      }
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
  }) {
    const order = await prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new Error("Order not found");

    // Idempotent — already paid
    if (order.paymentStatus === PaymentStatus.PAID) {
      await TicketService.issueTicketsForPaidOrder(order.id);
      return order;
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
    return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }
}
