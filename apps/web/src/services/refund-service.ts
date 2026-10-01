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

export class RefundService {
  static async refundOrder(input: {
    orderId: string;
    ticketIds?: string[];
    reason?: string;
    actorId?: string;
    ipAddress?: string;
  }) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: {
        tickets: true,
        payments: { where: { status: PaymentStatus.PAID }, orderBy: { createdAt: "desc" }, take: 1 },
        organization: true,
        event: true,
      },
    });

    if (order.paymentStatus === PaymentStatus.REFUNDED) {
      throw new Error("Ordren er allerede fullstendig refundert");
    }

    const ticketsToRefund = input.ticketIds?.length
      ? order.tickets.filter((t) => input.ticketIds!.includes(t.id) && t.status !== TicketStatus.REFUNDED)
      : order.tickets.filter((t) => t.status !== TicketStatus.REFUNDED);

    if (ticketsToRefund.length === 0) {
      throw new Error("Ingen billetter å refundere");
    }

    const isPartial = ticketsToRefund.length < order.tickets.length;
    const amountPerTicket = order.tickets.length > 0 ? Math.round(order.total / order.tickets.length) : order.total;
    const refundAmount = isPartial ? amountPerTicket * ticketsToRefund.length : order.total;

    const payment = order.payments[0];
    let providerRefundId: string | undefined;

    if (payment?.providerPaymentId && order.total > 0) {
      const provider = getPaymentProvider(payment.provider);
      const result = await provider.refund({
        providerPaymentId: payment.providerPaymentId,
        amount: refundAmount,
        currency: order.currency,
        reason: input.reason,
        idempotencyKey: `refund_${order.id}_${ticketsToRefund.map((t) => t.id).sort().join("_")}`,
      });
      providerRefundId = result.providerRefundId;
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

      const created = await tx.refund.create({
        data: {
          orderId: order.id,
          paymentId: payment?.id,
          amount: refundAmount,
          currency: order.currency,
          status: RefundStatus.SUCCEEDED,
          reason: input.reason,
          providerRefundId,
          ticketIds: ticketsToRefund.map((t) => t.id),
          processedById: input.actorId,
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
      action: "ORDER_REFUNDED",
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
