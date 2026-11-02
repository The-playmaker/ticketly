import {
  PaymentProviderType,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { TicketService } from "@/services/ticket-service";
import { writeAuditLog } from "@/lib/audit";
import { createOrderSnapshot } from "@ticketly/ticketing";
import { AppError } from "@/lib/api-error";

export async function markOrderPaidImpl(input: {
  orderId: string;
  provider: PaymentProviderType;
  providerSessionId?: string;
  providerPaymentId?: string;
  providerChargeId?: string;
  paymentMethod?: string;
  paymentType?: string;
  providerStatus?: string;
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
  if (input.providerPaymentId) {
    const linked = await prisma.payment.findFirst({
      where: { providerPaymentId: input.providerPaymentId, NOT: { orderId: order.id } },
    });
    if (linked) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED,
          paymentAnomaly: true,
          paymentAnomalyReason: "PAYMENT_ORDER_MISMATCH",
        },
      });
      await writeAuditLog({
        action: "PAYMENT_ORDER_MISMATCH",
        entityType: "Order",
        entityId: order.id,
        organizationId: order.organizationId,
        metadata: { providerPaymentId: input.providerPaymentId, otherOrderId: linked.orderId },
      });
      throw new AppError("PAYMENT_ORDER_MISMATCH", "Betaling tilhører ikke ordren", 409);
    }
  }
  if (input.amount != null && input.amount !== order.total) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: PaymentStatus.REVIEW_REQUIRED,
        paymentAnomaly: true,
        paymentAnomalyReason: `AMOUNT_MISMATCH expected=${order.total} got=${input.amount}`,
      },
    });
    await writeAuditLog({
      action: "PAYMENT_AMOUNT_MISMATCH",
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
        paymentStatus: PaymentStatus.REVIEW_REQUIRED,
        paymentAnomaly: true,
        paymentAnomalyReason: `CURRENCY_MISMATCH expected=${order.currency} got=${input.currency}`,
      },
    });
    await writeAuditLog({
      action: "PAYMENT_CURRENCY_MISMATCH",
      entityType: "Order",
      entityId: order.id,
      organizationId: order.organizationId,
      metadata: { reason: "CURRENCY_MISMATCH", expected: order.currency, got: input.currency },
    });
    throw new AppError("PAYMENT_CURRENCY_MISMATCH", "Valuta matcher ikke ordre", 409);
  }
  if (order.paymentAnomaly) throw new AppError("PAYMENT_ANOMALY", "Ordren er sperret", 409);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    if (fresh.paymentStatus === PaymentStatus.PAID) return;
    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PAID, paidAt: new Date() },
    });
    const existing = await tx.payment.findFirst({
      where: {
        orderId: order.id,
        OR: [
          input.providerSessionId ? { providerSessionId: input.providerSessionId } : undefined,
          input.providerPaymentId ? { providerPaymentId: input.providerPaymentId } : undefined,
          { orderId: order.id },
        ].filter(Boolean) as object[],
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: PaymentStatus.PAID,
          providerPaymentId: input.providerPaymentId ?? existing.providerPaymentId,
          providerSessionId: input.providerSessionId ?? existing.providerSessionId,
          providerChargeId: input.providerChargeId ?? existing.providerChargeId,
          paymentMethod: input.paymentMethod ?? existing.paymentMethod,
          paymentType: input.paymentType ?? existing.paymentType,
          providerStatus: input.providerStatus ?? existing.providerStatus,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: input.provider,
          providerSessionId: input.providerSessionId,
          providerPaymentId: input.providerPaymentId,
          providerChargeId: input.providerChargeId,
          paymentMethod: input.paymentMethod,
          paymentType: input.paymentType,
          providerStatus: input.providerStatus,
          amount: input.amount ?? order.total,
          currency: order.currency,
          status: PaymentStatus.PAID,
          idempotencyKey: input.externalEventId
            ? `paid_${input.externalEventId}`
            : `paid_${order.id}_${Date.now()}`,
        },
      });
    }
    await tx.ticketReservation.updateMany({
      where: { orderId: order.id, status: "ACTIVE" },
      data: { status: "CONVERTED" },
    });
  });
  await TicketService.issueTicketsForPaidOrder(order.id);
  try {
    await createOrderSnapshot(order.id);
  } catch (e) {
    console.error("OrderSnapshot failed", e);
  }
  try {
    await prisma.analyticsEvent.create({
      data: {
        type: "PAYMENT_SUCCESS",
        eventId: order.eventId,
        orderId: order.id,
        organizationId: order.organizationId,
      },
    });
  } catch {
    /* non-blocking */
  }
  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}
