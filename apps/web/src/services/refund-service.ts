import {
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  TicketStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { writeAuditLog } from "@/lib/audit";
import { sendRefundEmail } from "@/lib/email/templates";
import { assertTicketTransition } from "@/services/ticket-state-machine";
import { AppError } from "@/lib/api-error";

export class RefundService {
  static async refundOrder(input: {
    orderId: string;
    ticketIds?: string[];
    reason?: string;
    actorId?: string;
    ipAddress?: string;
    /** Never trust client org — optional assert against session org */
    organizationId?: string;
  }) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: {
        tickets: true,
        payments: {
          where: {
            status: {
              in: [
                PaymentStatus.PAID,
                PaymentStatus.PARTIALLY_REFUNDED,
                PaymentStatus.AUTHORIZED,
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        refunds: { where: { status: RefundStatus.SUCCEEDED } },
        organization: true,
        event: true,
      },
    });

    if (input.organizationId && order.organizationId !== input.organizationId) {
      throw new AppError("FORBIDDEN", "Ingen tilgang til denne ordren", 403);
    }

    if (order.paymentStatus === PaymentStatus.REFUNDED) {
      throw new AppError("ALREADY_REFUNDED", "Ordren er allerede fullstendig refundert", 409);
    }

    const ticketsToRefund = input.ticketIds?.length
      ? order.tickets.filter((t) => input.ticketIds!.includes(t.id) && t.status !== TicketStatus.REFUNDED)
      : order.tickets.filter((t) => t.status !== TicketStatus.REFUNDED);

    if (ticketsToRefund.length === 0) {
      throw new AppError("NO_TICKETS", "Ingen billetter å refundere", 400);
    }

    for (const t of ticketsToRefund) {
      assertTicketTransition(t.status, TicketStatus.REFUNDED);
    }

    const alreadyRefunded = order.refunds.reduce((s, r) => s + r.amount, 0);
    const isPartial = ticketsToRefund.length < order.tickets.length;
    const amountPerTicket =
      order.tickets.length > 0 ? Math.round(order.total / order.tickets.length) : order.total;
    let refundAmount = isPartial ? amountPerTicket * ticketsToRefund.length : order.total - alreadyRefunded;

    if (refundAmount <= 0) {
      throw new AppError("REFUND_ZERO", "Ingen beløp å refundere", 400);
    }
    if (alreadyRefunded + refundAmount > order.total) {
      refundAmount = order.total - alreadyRefunded;
    }
    if (refundAmount <= 0) {
      throw new AppError("REFUND_EXCEEDS_PAID", "Refusjon overstiger betalt beløp", 400);
    }

    const payment = order.payments[0];
    let providerRefundId: string | undefined;

    // Create PENDING refund first; only mark SUCCEEDED after provider confirms
    const pendingRefund = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment?.id,
        amount: refundAmount,
        currency: order.currency,
        status: RefundStatus.PENDING,
        reason: input.reason,
        ticketIds: ticketsToRefund.map((t) => t.id),
        processedById: input.actorId,
      },
    });

    if (payment?.providerPaymentId && order.total > 0) {
      const provider = getPaymentProvider(payment.provider);
      try {
        const result = await provider.refund({
          providerPaymentId: payment.providerPaymentId,
          providerChargeId: payment.providerChargeId ?? undefined,
          amount: refundAmount,
          currency: order.currency,
          reason: input.reason,
          idempotencyKey: `refund_${order.id}_${ticketsToRefund.map((t) => t.id).sort().join("_")}`.slice(0, 64),
        });
        providerRefundId = result.providerRefundId;

        // Stripe mock / sync providers may return SUCCEEDED immediately;
        // Nexi returns PENDING until payment.refund.completed — still apply
        // ticket state after provider accepted the refund operation (201).
        if (result.status === "FAILED") {
          await prisma.refund.update({
            where: { id: pendingRefund.id },
            data: { status: RefundStatus.FAILED, providerRefundId },
          });
          throw new AppError("REFUND_PROVIDER_FAILED", "Refusjon feilet hos betalingsleverandør", 502);
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        await prisma.refund.update({
          where: { id: pendingRefund.id },
          data: { status: RefundStatus.FAILED },
        });
        throw e;
      }
    }

    const refund = await prisma.$transaction(async (tx) => {
      for (const ticket of ticketsToRefund) {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: TicketStatus.REFUNDED },
        });
        await tx.ticketType.update({
          where: { id: ticket.ticketTypeId },
          data: { quantitySold: { decrement: 1 } },
        });
      }

      const created = await tx.refund.update({
        where: { id: pendingRefund.id },
        data: {
          status: RefundStatus.SUCCEEDED,
          providerRefundId,
        },
      });

      const remainingValid = await tx.ticket.count({
        where: {
          orderId: order.id,
          status: { in: [TicketStatus.VALID, TicketStatus.CHECKED_IN, TicketStatus.TRANSFERRED] },
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: remainingValid === 0 ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
          orderStatus: remainingValid === 0 ? OrderStatus.REFUNDED : order.orderStatus,
        },
      });

      if (payment) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: remainingValid === 0 ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
          },
        });
      }

      return created;
    });

    await writeAuditLog({
      actorId: input.actorId,
      organizationId: order.organizationId,
      action: "ORDER_REFUND",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        refundId: refund.id,
        amount: refundAmount,
        ticketIds: ticketsToRefund.map((t) => t.id),
        reason: input.reason,
      },
      ipAddress: input.ipAddress,
    });

    try {
      await sendRefundEmail({
        to: order.customerEmail,
        customerName: `${order.customerFirstName} ${order.customerLastName}`,
        orderNumber: order.orderNumber,
        amount: refundAmount,
        currency: order.currency,
      });
    } catch (err) {
      console.error("Failed to send refund email", err);
    }

    return refund;
  }

  static async cancelTicket(input: {
    ticketId: string;
    actorId?: string;
    reason?: string;
  }) {
    const ticket = await prisma.ticket.update({
      where: { id: input.ticketId },
      data: { status: TicketStatus.CANCELLED },
      include: { order: true },
    });

    await writeAuditLog({
      actorId: input.actorId,
      organizationId: ticket.order.organizationId,
      action: "TICKET_CANCELLED",
      entityType: "Ticket",
      entityId: ticket.id,
      metadata: { reason: input.reason },
    });

    return ticket;
  }
}
