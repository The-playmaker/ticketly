import {
  EventStatus,
  OrderStatus,
  PaymentStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";
import { sendEventCancelledEmail } from "@/lib/email/templates";
import { RefundService } from "@/services/refund-service";

export class EventService {
  static async listPublic(params?: { take?: number; city?: string }) {
    const now = new Date();
    return prisma.event.findMany({
      where: {
        status: { in: [EventStatus.PUBLISHED, EventStatus.PAUSED, EventStatus.SOLD_OUT] },
        visibility: "PUBLIC",
        startsAt: { gte: now },
        ...(params?.city ? { city: { equals: params.city, mode: "insensitive" } } : {}),
      },
      include: {
        organization: { select: { name: true, slug: true } },
        venue: true,
        ticketTypes: {
          where: { isVisible: true },
          orderBy: { sortOrder: "asc" },
          include: { priceTiers: { orderBy: { sortOrder: "asc" } } },
        },
      },
      orderBy: { startsAt: "asc" },
      take: params?.take ?? 50,
    });
  }

  static async getBySlug(slug: string) {
    return prisma.event.findFirst({
      where: {
        slug,
        OR: [
          { status: { in: [EventStatus.PUBLISHED, EventStatus.PAUSED, EventStatus.SOLD_OUT] } },
          { visibility: "UNLISTED", status: { not: EventStatus.DRAFT } },
        ],
      },
      include: {
        organization: true,
        sellerOrganization: true,
        venue: true,
        images: { orderBy: { sortOrder: "asc" } },
        ticketTypes: {
          where: { isVisible: true },
          orderBy: { sortOrder: "asc" },
          include: { priceTiers: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
  }

  static async create(
    data: Prisma.EventUncheckedCreateInput,
    actorId?: string
  ) {
    const event = await prisma.event.create({
      data: {
        ...data,
        slug: data.slug || slugify(data.name),
      },
    });

    await writeAuditLog({
      actorId,
      organizationId: event.organizationId,
      action: "EVENT_CREATED",
      entityType: "Event",
      entityId: event.id,
      metadata: { name: event.name },
    });

    return event;
  }

  static async update(
    id: string,
    data: Prisma.EventUncheckedUpdateInput,
    actorId?: string
  ) {
    const event = await prisma.event.update({ where: { id }, data });
    await writeAuditLog({
      actorId,
      organizationId: event.organizationId,
      action: "EVENT_UPDATED",
      entityType: "Event",
      entityId: event.id,
      metadata: data as object,
    });
    return event;
  }

  static async publish(id: string, actorId?: string) {
    return this.update(
      id,
      { status: EventStatus.PUBLISHED, salesPausedAt: null, visibility: "PUBLIC" },
      actorId
    );
  }

  static async cancel(
    id: string,
    options: { refundAll?: boolean; actorId?: string } = {}
  ) {
    const event = await prisma.event.update({
      where: { id },
      data: { status: EventStatus.CANCELLED },
    });

    const orders = await prisma.order.findMany({
      where: {
        eventId: id,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: { in: [OrderStatus.CONFIRMED, OrderStatus.PENDING] },
      },
    });

    if (options.refundAll) {
      for (const order of orders) {
        await RefundService.refundOrder({
          orderId: order.id,
          reason: "Event cancelled",
          actorId: options.actorId,
        });
      }
    } else {
      for (const order of orders) {
        try {
          await sendEventCancelledEmail({
            to: order.customerEmail,
            customerName: `${order.customerFirstName} ${order.customerLastName}`,
            eventName: event.name,
            orderNumber: order.orderNumber,
          });
        } catch {
          /* ignore */
        }
      }
    }

    await writeAuditLog({
      actorId: options.actorId,
      organizationId: event.organizationId,
      action: "EVENT_CANCELLED",
      entityType: "Event",
      entityId: event.id,
      metadata: { refundAll: !!options.refundAll, orderCount: orders.length },
    });

    return event;
  }

  static async getDashboardStats(eventId: string) {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: { ticketTypes: true },
    });

    const paidOrders = await prisma.order.findMany({
      where: { eventId, paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] } },
    });

    const sold = event.ticketTypes.reduce((s, t) => s + t.quantitySold, 0);
    const revenue = paidOrders.reduce((s, o) => s + o.total - (o.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED ? 0 : 0), 0);
    const refunded = await prisma.refund.aggregate({
      where: { order: { eventId }, status: "SUCCEEDED" },
      _sum: { amount: true },
    });
    const checkedIn = await prisma.ticket.count({
      where: { eventId, status: "CHECKED_IN" },
    });

    const recentCheckIns = await prisma.checkIn.findMany({
      where: { eventId, result: "SUCCESS" },
      include: {
        ticket: { include: { ticketType: true } },
      },
      orderBy: { checkedInAt: "desc" },
      take: 20,
    });

    return {
      event,
      sold,
      capacity: event.capacity,
      percentSold: event.capacity > 0 ? Math.round((sold / event.capacity) * 100) : 0,
      checkedIn,
      revenue,
      refunded: refunded._sum.amount ?? 0,
      averageOrderValue: paidOrders.length ? Math.round(revenue / paidOrders.length) : 0,
      recentCheckIns,
      byTicketType: event.ticketTypes.map((t) => ({
        id: t.id,
        name: t.name,
        sold: t.quantitySold,
        total: t.quantityTotal,
      })),
    };
  }

  static async getOrgDashboardStats(organizationId: string) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        organizationId,
        paymentStatus: {
          in: [
            PaymentStatus.PAID,
            PaymentStatus.PARTIALLY_REFUNDED,
            PaymentStatus.REFUNDED,
            PaymentStatus.FAILED,
            PaymentStatus.PENDING,
          ],
        },
      },
      select: { total: true, createdAt: true, paidAt: true, paymentStatus: true },
    });

    const paid = orders.filter(
      (o) =>
        o.paymentStatus === PaymentStatus.PAID ||
        o.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED
    );
    const revenueTotal = paid.reduce((s, o) => s + o.total, 0);
    const revenueToday = paid
      .filter((o) => (o.paidAt ?? o.createdAt) >= startOfDay)
      .reduce((s, o) => s + o.total, 0);

    const ticketsSold = await prisma.ticket.count({
      where: {
        event: { organizationId },
        status: { in: ["VALID", "CHECKED_IN", "TRANSFERRED"] },
      },
    });
    const checkedIn = await prisma.ticket.count({
      where: { event: { organizationId }, status: "CHECKED_IN" },
    });

    const activeReservations = await prisma.ticketReservation.count({
      where: {
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
        event: { organizationId },
      },
    });

    const refundsAgg = await prisma.refund.aggregate({
      where: { order: { organizationId }, status: "SUCCEEDED" },
      _sum: { amount: true },
      _count: true,
    });

    const failedPayments = orders.filter((o) => o.paymentStatus === PaymentStatus.FAILED).length;

    const pageViews = await prisma.analyticsEvent.count({
      where: { type: "PAGE_VIEW", event: { organizationId } },
    });
    const checkoutStarts = await prisma.analyticsEvent.count({
      where: { type: "CHECKOUT_STARTED", event: { organizationId } },
    });
    const conversion =
      pageViews > 0 ? Math.round((paid.length / pageViews) * 1000) / 10 : null;

    const events = await prisma.event.findMany({
      where: { organizationId },
      select: { capacity: true, ticketTypes: { select: { quantitySold: true } } },
    });
    const capacity = events.reduce((s, e) => s + e.capacity, 0);
    const sold = events.reduce(
      (s, e) => s + e.ticketTypes.reduce((a, t) => a + t.quantitySold, 0),
      0
    );

    return {
      revenueToday,
      revenueTotal,
      ticketsSold,
      checkedIn,
      capacity,
      percentSold: capacity > 0 ? Math.round((sold / capacity) * 100) : 0,
      averageOrderValue: paid.length ? Math.round(revenueTotal / paid.length) : 0,
      orderCount: paid.length,
      activeReservations,
      refundedAmount: refundsAgg._sum.amount ?? 0,
      refundCount: refundsAgg._count,
      failedPayments,
      pageViews,
      checkoutStarts,
      conversionPercent: conversion,
    };
  }
}
