import { PaymentStatus, TicketStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { sendOrderConfirmationEmail, sendTicketDeliveryEmail } from "@/lib/email/templates";
import { formatEventDateTime } from "@/lib/time";
import { withCoverCacheBust } from "@/lib/media/cover-url";

/** Same email schema as checkout / team invite. */
export const customerEmailSchema = z.string().email();

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.VALID,
  TicketStatus.CHECKED_IN,
  TicketStatus.TRANSFERRED,
];

const BLOCKED_RESEND_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.FAILED,
  PaymentStatus.REVIEW_REQUIRED,
  PaymentStatus.REFUNDED,
  PaymentStatus.AUTHORIZED,
  PaymentStatus.CANCELLED,
];

function isActiveTicketStatus(status: TicketStatus) {
  return ACTIVE_TICKET_STATUSES.includes(status);
}

export class OrderEmailService {
  /**
   * Correct customer email on the order only — never touches Stripe/payment rows.
   */
  static async updateCustomerEmail(input: {
    orderNumber: string;
    email: string;
    actorId: string;
    ipAddress?: string | null;
  }) {
    const parsed = customerEmailSchema.safeParse(input.email.trim().toLowerCase());
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Ugyldig e-postadresse", 400);
    }
    const newEmail = parsed.data;

    const order = await prisma.order.findUnique({ where: { orderNumber: input.orderNumber } });
    if (!order) throw new AppError("NOT_FOUND", "Ordre ikke funnet", 404);

    const oldEmail = order.customerEmail;
    if (oldEmail.toLowerCase() === newEmail) {
      return {
        email: oldEmail,
        unchanged: true as const,
        audit: null,
      };
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { customerEmail: newEmail },
      select: {
        id: true,
        orderNumber: true,
        customerEmail: true,
        organizationId: true,
        paymentStatus: true,
        total: true,
      },
    });

    const audit = await writeAuditLog({
      actorId: input.actorId,
      organizationId: order.organizationId,
      action: "ORDER_CUSTOMER_EMAIL_CHANGED",
      entityType: "Order",
      entityId: order.id,
      ipAddress: input.ipAddress,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        oldEmail,
        newEmail,
        actorId: input.actorId,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      email: updated.customerEmail,
      unchanged: false as const,
      audit: {
        id: audit.id,
        action: audit.action,
        createdAt: audit.createdAt,
      },
      order: updated,
    };
  }

  /**
   * Re-deliver confirmation + ticket email for paid / partially refunded orders.
   * Never issues tickets, mutates inventory, or changes payment status.
   */
  static async resendOrderEmails(input: {
    orderNumber: string;
    actorId: string;
    ipAddress?: string | null;
  }) {
    const order = await prisma.order.findUnique({
      where: { orderNumber: input.orderNumber },
      include: {
        tickets: true,
        event: { include: { organization: true, venue: true } },
      },
    });
    if (!order) throw new AppError("NOT_FOUND", "Ordre ikke funnet", 404);

    if (BLOCKED_RESEND_STATUSES.includes(order.paymentStatus)) {
      throw new AppError(
        "ORDER_RESEND_BLOCKED",
        `Kan ikke sende billetter på nytt for status ${order.paymentStatus}`,
        409
      );
    }
    if (
      order.paymentStatus !== PaymentStatus.PAID &&
      order.paymentStatus !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new AppError(
        "ORDER_RESEND_BLOCKED",
        `Kan ikke sende billetter på nytt for status ${order.paymentStatus}`,
        409
      );
    }

    const activeTickets = order.tickets.filter((t) => isActiveTicketStatus(t.status));
    if (order.tickets.length === 0 || activeTickets.length === 0) {
      throw new AppError(
        "NO_TICKETS",
        "Ordren har ingen aktive billetter å sende",
        409
      );
    }

    const ticketCountBefore = order.tickets.length;
    const appUrl = process.env.APP_URL ?? "http://localhost:3456";
    const ticketsUrl = `${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}`;
    const org = order.event.organization;
    const eventWhen = formatEventDateTime(order.event.startsAt, order.event.timezone);
    const coverImageUrl = withCoverCacheBust(order.event.coverImageUrl, order.event.updatedAt);
    const customerName = `${order.customerFirstName} ${order.customerLastName}`;

    const confirm = await sendOrderConfirmationEmail({
      to: order.customerEmail,
      customerName,
      orderNumber: order.orderNumber,
      eventName: order.event.name,
      eventWhen,
      venue: order.event.venue?.name ?? order.event.city ?? undefined,
      ageLimit: order.event.ageLimit,
      quantity: activeTickets.length,
      total: order.total,
      currency: order.currency,
      sellerName: org.legalName ?? org.name,
      ticketsUrl,
      supportEmail: org.customerServiceEmail ?? org.contactEmail,
      supportPhone: org.customerServicePhone,
      orderId: order.id,
      eventId: order.eventId,
      coverImageUrl,
    });

    const tickets = await sendTicketDeliveryEmail({
      to: order.customerEmail,
      customerName,
      eventName: order.event.name,
      eventWhen,
      venue: order.event.venue?.name ?? order.event.city ?? undefined,
      ageLimit: order.event.ageLimit,
      orderNumber: order.orderNumber,
      ticketsUrl,
      supportEmail: org.customerServiceEmail ?? org.contactEmail,
      supportPhone: org.customerServicePhone,
      orderId: order.id,
      eventId: order.eventId,
      coverImageUrl,
    });

    const ticketCountAfter = await prisma.ticket.count({ where: { orderId: order.id } });
    if (ticketCountAfter !== ticketCountBefore) {
      throw new AppError(
        "TICKET_COUNT_CHANGED",
        "Uventet billettendring under e-postsending",
        500
      );
    }

    const audit = await writeAuditLog({
      actorId: input.actorId,
      organizationId: order.organizationId,
      action: "ORDER_EMAIL_RESENT",
      entityType: "Order",
      entityId: order.id,
      ipAddress: input.ipAddress,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        destinationEmail: order.customerEmail,
        actorId: input.actorId,
        timestamp: new Date().toISOString(),
        activeTicketCount: activeTickets.length,
        paymentStatus: order.paymentStatus,
      },
    });

    return {
      ok: Boolean(confirm?.ok !== false && tickets?.ok !== false),
      email: order.customerEmail,
      ticketCount: ticketCountAfter,
      activeTicketCount: activeTickets.length,
      audit: {
        id: audit.id,
        action: audit.action,
        createdAt: audit.createdAt,
      },
    };
  }
}
