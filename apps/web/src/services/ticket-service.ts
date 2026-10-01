import {
  OrderStatus,
  PaymentStatus,
  ReservationStatus,
  TicketStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildQrPayload,
  generatePublicTicketId,
  generateSecureToken,
} from "@/lib/tickets/token";
import { sendOrderConfirmationEmail } from "@/lib/email/templates";

export class TicketService {
  /**
   * Called after payment is confirmed via webhook.
   * Converts reserved inventory to sold and issues unique QR tickets.
   */
  static async issueTicketsForPaidOrder(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, event: true, tickets: true },
    });

    if (!order) throw new Error("Order not found");
    if (order.tickets.length > 0) {
      // Idempotent — already issued
      return order.tickets;
    }
    if (order.paymentStatus !== PaymentStatus.PAID) {
      throw new Error("Cannot issue tickets for unpaid order");
    }

    const tickets = await prisma.$transaction(async (tx) => {
      const created = [];

      for (const item of order.items) {
        // Move reserved → sold under lock
        await tx.$queryRaw`
          SELECT id FROM "TicketType" WHERE id = ${item.ticketTypeId} FOR UPDATE
        `;

        await tx.ticketType.update({
          where: { id: item.ticketTypeId },
          data: {
            quantityReserved: { decrement: item.quantity },
            quantitySold: { increment: item.quantity },
          },
        });

        for (let i = 0; i < item.quantity; i++) {
          const secureToken = generateSecureToken(32);
          const ticket = await tx.ticket.create({
            data: {
              publicId: generatePublicTicketId(),
              secureToken,
              orderId: order.id,
              orderItemId: item.id,
              eventId: order.eventId,
              ticketTypeId: item.ticketTypeId,
              holderName: `${order.customerFirstName} ${order.customerLastName}`,
              holderEmail: order.customerEmail,
              status: TicketStatus.VALID,
            },
          });
          created.push(ticket);
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: { orderStatus: OrderStatus.CONFIRMED },
      });

      // Mark any leftover active reservations for session as converted
      if (order.reservationSessionId) {
        await tx.ticketReservation.updateMany({
          where: {
            sessionId: order.reservationSessionId,
            status: { in: [ReservationStatus.ACTIVE, ReservationStatus.CONVERTED] },
          },
          data: { status: ReservationStatus.CONVERTED, orderId: order.id },
        });
      }

      return created;
    });

    const appUrl = process.env.APP_URL ?? "http://localhost:3456";
    try {
      await sendOrderConfirmationEmail({
        to: order.customerEmail,
        customerName: `${order.customerFirstName} ${order.customerLastName}`,
        orderNumber: order.orderNumber,
        eventName: order.event.name,
        total: order.total,
        currency: order.currency,
        ticketsUrl: `${appUrl}/orders/${order.orderNumber}`,
      });
    } catch (err) {
      console.error("Failed to send order confirmation email", err);
    }

    return tickets;
  }

  static getQrValue(secureToken: string) {
    return buildQrPayload(secureToken);
  }

  static async transferTicket(input: {
    ticketId: string;
    toName: string;
    toEmail: string;
    fromUserId?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findUnique({
        where: { id: input.ticketId },
        include: { event: true },
      });
      if (!ticket) throw new Error("Billett ikke funnet");
      if (!ticket.event.allowTransfer) {
        throw new Error("Overføring er ikke tillatt for dette arrangementet");
      }
      if (ticket.status !== TicketStatus.VALID) {
        throw new Error("Kun gyldige billetter kan overføres");
      }

      const oldToken = ticket.secureToken;
      const newToken = generateSecureToken(32);

      const updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          secureToken: newToken,
          holderName: input.toName,
          holderEmail: input.toEmail.toLowerCase(),
          status: TicketStatus.VALID,
        },
      });

      await tx.ticketTransfer.create({
        data: {
          ticketId: ticket.id,
          fromUserId: input.fromUserId,
          fromEmail: ticket.holderEmail ?? "",
          toEmail: input.toEmail.toLowerCase(),
          toName: input.toName,
          oldToken,
          newToken,
        },
      });

      return updated;
    });
  }
}
