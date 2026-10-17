import {
  OrderStatus,
  PaymentStatus,
  ReservationStatus,
  TicketStatus,
  EventStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildQrPayload,
  encryptTicketToken,
  generatePublicTicketId,
  generateSecureToken,
  hashTicketToken,
  resolveRawTicketToken,
} from "@/lib/tickets/token";
import { sendOrderConfirmationEmail, sendTicketDeliveryEmail } from "@/lib/email/templates";
import { formatEventDateTime } from "@/lib/time";
import { withCoverCacheBust } from "@/lib/media/cover-url";
import { assertTicketTransition } from "@/services/ticket-state-machine";
import { writeAuditLog } from "@/lib/audit";
import { AppError } from "@/lib/api-error";
import { secureLogError } from "@/lib/security/redact";

type FulfillResult = {
  tickets: Awaited<ReturnType<typeof prisma.ticket.findMany>>;
  newlyIssued: boolean;
  order: {
    id: string;
    orderNumber: string;
    accessToken: string;
    customerEmail: string;
    customerFirstName: string;
    customerLastName: string;
    customerId: string | null;
    total: number;
    currency: string;
    eventId: string;
    event: {
      name: string;
      startsAt: Date;
      timezone: string;
      ageLimit: number | null;
      coverImageUrl: string | null;
      updatedAt: Date;
      city: string | null;
      venue: { name: string } | null;
      organization: {
        name: string;
        legalName: string | null;
        customerServiceEmail: string | null;
        contactEmail: string | null;
        customerServicePhone: string | null;
      } | null;
    };
  };
};

export class TicketService {
  /**
   * Exactly-once ticket issuance for a paid order.
   *
   * Serializes on `SELECT … FOR UPDATE` of the Order row inside the same
   * transaction that re-queries ticket count / `ticketsFulfilledAt` and creates
   * tickets. Concurrent Stripe webhooks (session.completed + payment_intent.succeeded),
   * retries, and multi-worker races all collapse to a single issuer.
   *
   * Automatic confirmation / delivery emails are sent only when this call is the
   * issuer (`newlyIssued`), so duplicate webhooks do not double-email.
   */
  static async issueTicketsForPaidOrder(orderId: string) {
    const result = await this.fulfillPaidOrderLocked(orderId);

    if (result.newlyIssued) {
      await this.sendFulfillmentEmails(result);
    }

    return result.tickets;
  }

  /** Locked fulfill path — used by tests to assert newlyIssued under concurrency. */
  static async fulfillPaidOrderLocked(orderId: string): Promise<FulfillResult> {
    return prisma.$transaction(async (tx) => {
      // Serialize all fulfillment for this order (payment webhooks, retries, workers)
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `;
      if (!locked[0]) throw new AppError("ORDER_NOT_FOUND", "Order not found", 404);

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          tickets: true,
          event: { include: { organization: true, venue: true } },
        },
      });

      if (!order) throw new AppError("ORDER_NOT_FOUND", "Order not found", 404);
      if (order.paymentStatus !== PaymentStatus.PAID) {
        throw new AppError("ORDER_UNPAID", "Cannot issue tickets for unpaid order", 409);
      }
      if (order.paymentAnomaly) {
        throw new AppError("PAYMENT_ANOMALY", "Cannot issue tickets for anomalous payment", 409);
      }
      if (order.event.status === EventStatus.CANCELLED) {
        throw new AppError("EVENT_CANCELLED", "Arrangement er kansellert", 409);
      }

      // Re-check under lock — never use tickets.length outside this transaction as sole guard
      if (order.ticketsFulfilledAt != null || order.tickets.length > 0) {
        if (order.ticketsFulfilledAt == null && order.tickets.length > 0) {
          // Legacy / race remnant: tickets exist but marker missing — claim marker, do not create more
          await tx.order.update({
            where: { id: order.id },
            data: {
              ticketsFulfilledAt: order.paidAt ?? order.tickets[0]!.createdAt,
              orderStatus:
                order.orderStatus === OrderStatus.PENDING
                  ? OrderStatus.CONFIRMED
                  : order.orderStatus,
            },
          });
        }
        return { order, tickets: order.tickets, newlyIssued: false };
      }

      const created = [];

      for (const item of order.items) {
        const typeRows = await tx.$queryRaw<
          {
            id: string;
            quantity_total: number;
            quantity_sold: number;
            quantity_reserved: number;
            admission_count: number;
          }[]
        >`
          SELECT id, "quantityTotal" as quantity_total, "quantitySold" as quantity_sold,
                 "quantityReserved" as quantity_reserved,
                 COALESCE("admissionCount", 1) as admission_count
          FROM "TicketType" WHERE id = ${item.ticketTypeId} FOR UPDATE
        `;
        const row = typeRows[0];
        if (!row) throw new AppError("TICKET_TYPE_MISSING", "Billettype mangler", 500);

        // After converting reserved→sold, sold must not exceed total (sale units)
        if (row.quantity_sold + item.quantity > row.quantity_total) {
          throw new AppError(
            "INVENTORY_INVARIANT",
            "Kan ikke utstede billetter — kapasitet brutt",
            409
          );
        }

        await tx.ticketType.update({
          where: { id: item.ticketTypeId },
          data: {
            quantityReserved: { decrement: Math.min(item.quantity, row.quantity_reserved) },
            quantitySold: { increment: item.quantity },
          },
        });

        // Bundles: 1 purchased unit → admissionCount individual QR tickets
        const admitPerUnit = Math.max(1, row.admission_count || 1);
        const ticketsToIssue = item.quantity * admitPerUnit;
        for (let i = 0; i < ticketsToIssue; i++) {
          const rawToken = generateSecureToken(32);
          const ticket = await tx.ticket.create({
            data: {
              publicId: generatePublicTicketId(),
              tokenHash: hashTicketToken(rawToken),
              tokenCipher: encryptTicketToken(rawToken),
              secureToken: null,
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
        data: {
          orderStatus: OrderStatus.CONFIRMED,
          ticketsFulfilledAt: new Date(),
        },
      });

      if (order.reservationSessionId) {
        await tx.ticketReservation.updateMany({
          where: {
            sessionId: order.reservationSessionId,
            status: { in: [ReservationStatus.ACTIVE, ReservationStatus.CONVERTED] },
          },
          data: { status: ReservationStatus.CONVERTED, orderId: order.id },
        });
      }

      return { order, tickets: created, newlyIssued: true };
    });
  }

  private static async sendFulfillmentEmails(result: FulfillResult) {
    const { order, tickets } = result;
    const appUrl = process.env.APP_URL ?? "http://localhost:3456";
    const ticketsUrl = `${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}`;
    // Email failure must never invalidate paid order / issued tickets
    try {
      const eventWhen = formatEventDateTime(order.event.startsAt, order.event.timezone);
      const org = order.event.organization;
      const coverImageUrl = withCoverCacheBust(
        order.event.coverImageUrl,
        order.event.updatedAt
      );
      await sendOrderConfirmationEmail({
        to: order.customerEmail,
        customerName: `${order.customerFirstName} ${order.customerLastName}`,
        orderNumber: order.orderNumber,
        eventName: order.event.name,
        eventWhen,
        venue: order.event.venue?.name ?? order.event.city ?? undefined,
        ageLimit: order.event.ageLimit,
        quantity: tickets.length,
        total: order.total,
        currency: order.currency,
        sellerName: org?.legalName ?? org?.name,
        ticketsUrl,
        supportEmail: org?.customerServiceEmail ?? org?.contactEmail,
        supportPhone: org?.customerServicePhone,
        orderId: order.id,
        eventId: order.eventId,
        userId: order.customerId ?? undefined,
        coverImageUrl,
      });
      await sendTicketDeliveryEmail({
        to: order.customerEmail,
        customerName: `${order.customerFirstName} ${order.customerLastName}`,
        eventName: order.event.name,
        eventWhen,
        venue: order.event.venue?.name ?? order.event.city ?? undefined,
        ageLimit: order.event.ageLimit,
        orderNumber: order.orderNumber,
        ticketsUrl,
        supportEmail: org?.customerServiceEmail ?? org?.contactEmail,
        supportPhone: org?.customerServicePhone,
        orderId: order.id,
        eventId: order.eventId,
        coverImageUrl,
      });
    } catch (err) {
      secureLogError("Failed to send order/ticket email", err);
    }
  }

  static getQrValue(rawToken: string) {
    return buildQrPayload(rawToken);
  }

  static getDisplayToken(ticket: {
    tokenCipher?: string | null;
    secureToken?: string | null;
  }) {
    return resolveRawTicketToken(ticket);
  }

  static async transferTicket(input: {
    ticketId: string;
    toName: string;
    toEmail: string;
    fromUserId?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Ticket" WHERE id = ${input.ticketId} FOR UPDATE
      `;
      if (!rows[0]) throw new AppError("TICKET_NOT_FOUND", "Billett ikke funnet", 404);

      const ticket = await tx.ticket.findUniqueOrThrow({
        where: { id: input.ticketId },
        include: { event: true },
      });
      if (!ticket.event.allowTransfer) {
        throw new AppError("TRANSFER_DISABLED", "Overføring er ikke tillatt", 403);
      }
      assertTicketTransition(ticket.status, TicketStatus.TRANSFERRED);

      const oldRaw = resolveRawTicketToken(ticket) ?? "";
      const newToken = generateSecureToken(32);

      // Invalidate old QR by rotating hash; keep row VALID for new holder
      const updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          tokenHash: hashTicketToken(newToken),
          tokenCipher: encryptTicketToken(newToken),
          secureToken: null,
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
          oldToken: oldRaw ? hashTicketToken(oldRaw) : "unknown",
          newToken: hashTicketToken(newToken),
        },
      });

      await writeAuditLog({
        actorId: input.fromUserId,
        action: "TICKET_TRANSFER",
        entityType: "Ticket",
        entityId: ticket.id,
        organizationId: ticket.event.organizationId,
        metadata: { toEmail: input.toEmail },
      });

      return updated;
    });
  }

  static async transition(ticketId: string, to: TicketStatus, _actorId?: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      assertTicketTransition(ticket.status, to);
      return tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: to,
          checkedInAt: to === TicketStatus.CHECKED_IN ? new Date() : ticket.checkedInAt,
        },
      });
    });
  }
}
