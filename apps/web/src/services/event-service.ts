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
    const { getEventPublishBlockers, formatPublishBlockedMessage } = await import(
      "@/lib/publish/readiness"
    );
    const { resolvePaymentProviderType } = await import("@/lib/payments");
    const { AppError } = await import("@/lib/api-error");
    const { PaymentProviderType } = await import("@prisma/client");

    const event = await prisma.event.findUniqueOrThrow({
      where: { id },
      include: {
        organization: true,
        sellerOrganization: true,
        venue: true,
        ticketTypes: true,
      },
    });

    let paymentConfigured = false;
    try {
      const provider = resolvePaymentProviderType();
      paymentConfigured =
        provider === PaymentProviderType.NEXI ||
        provider === PaymentProviderType.STRIPE ||
        (provider === PaymentProviderType.MOCK && process.env.NODE_ENV !== "production");
    } catch {
      paymentConfigured = false;
    }

    // Org-level payment config also counts
    const orgPay = await prisma.organizationPaymentConfiguration.findFirst({
      where: {
        organizationId: event.sellerOrganizationId ?? event.organizationId,
        isActive: true,
      },
    });
    if (orgPay) paymentConfigured = true;

    const blockers = getEventPublishBlockers({
      event,
      organizer: event.organization,
      seller: event.sellerOrganization ?? event.organization,
      ticketTypes: event.ticketTypes,
      venue: event.venue,
      paymentConfigured,
    });

    if (blockers.length) {
      throw new AppError("PUBLISH_BLOCKED", formatPublishBlockedMessage(blockers), 400, {
        blockers,
      });
    }

    return this.update(
      id,
      { status: EventStatus.PUBLISHED, salesPausedAt: null, visibility: "PUBLIC" },
      actorId
    );
  }

  /**
   * Duplicate event metadata, venue, ticket types, tax/checkout/refund config.
   * Does NOT copy orders, tickets, attendees, payments, check-ins, or promo usage.
   */
  static async duplicate(sourceId: string, actorId?: string) {
    const source = await prisma.event.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        ticketTypes: { include: { priceTiers: true }, orderBy: { sortOrder: "asc" } },
        images: { orderBy: { sortOrder: "asc" } },
      },
    });

    const baseSlug = `${source.slug}-kopi`;
    let slug = baseSlug;
    let n = 1;
    while (await prisma.event.findFirst({ where: { organizationId: source.organizationId, slug } })) {
      slug = `${baseSlug}-${n++}`;
    }

    const weekMs = 7 * 24 * 60 * 60_000;
    const created = await prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          organizationId: source.organizationId,
          sellerOrganizationId: source.sellerOrganizationId,
          venueId: source.venueId,
          seriesId: source.seriesId,
          name: `${source.name} (kopi)`,
          slug,
          description: source.description,
          shortDescription: source.shortDescription,
          address: source.address,
          postalCode: source.postalCode,
          city: source.city,
          country: source.country,
          timezone: source.timezone,
          startsAt: new Date(source.startsAt.getTime() + weekMs),
          endsAt: new Date(source.endsAt.getTime() + weekMs),
          doorsOpenAt: source.doorsOpenAt
            ? new Date(source.doorsOpenAt.getTime() + weekMs)
            : null,
          ageLimit: source.ageLimit,
          coverImageUrl: source.coverImageUrl,
          capacity: source.capacity,
          status: EventStatus.DRAFT,
          visibility: source.visibility,
          category: source.category,
          salesStartAt: null,
          salesEndAt: null,
          publishAt: null,
          salesPausedAt: null,
          availabilityDisplay: source.availabilityDisplay,
          lowStockThreshold: source.lowStockThreshold,
          soldOutDisplay: source.soldOutDisplay,
          allowTransfer: source.allowTransfer,
          serviceFee: source.serviceFee,
          serviceFeeMode: source.serviceFeeMode,
          currency: source.currency,
          refundPolicyType: source.refundPolicyType,
          refundPolicyText: source.refundPolicyText,
          termsVersion: source.termsVersion,
          waitlistEnabled: source.waitlistEnabled,
          waitlistOnReleaseSoldOut: source.waitlistOnReleaseSoldOut,
          reminder24hEnabled: source.reminder24hEnabled,
          reminder3hEnabled: source.reminder3hEnabled,
        },
      });

      for (const img of source.images) {
        await tx.eventImage.create({
          data: {
            eventId: event.id,
            url: img.url,
            alt: img.alt,
            sortOrder: img.sortOrder,
          },
        });
      }

      for (const tt of source.ticketTypes) {
        const createdTt = await tx.ticketType.create({
          data: {
            eventId: event.id,
            name: tt.name,
            description: tt.description,
            price: tt.price,
            vatRate: tt.vatRate,
            taxTreatmentId: tt.taxTreatmentId,
            serviceFee: tt.serviceFee,
            serviceFeeTaxTreatmentId: tt.serviceFeeTaxTreatmentId,
            quantityTotal: tt.quantityTotal,
            quantityReleased: 0,
            quantitySold: 0,
            quantityReserved: 0,
            maxPerOrder: tt.maxPerOrder,
            minPerOrder: tt.minPerOrder,
            salesStartAt: null,
            salesEndAt: null,
            salesPausedAt: null,
            isVisible: tt.isVisible,
            isPubliclyPurchasable: tt.isPubliclyPurchasable,
            releaseMode: tt.releaseMode,
            admissionCount: tt.admissionCount,
            isBundle: tt.isBundle,
            sortOrder: tt.sortOrder,
          },
        });
        for (const tier of tt.priceTiers) {
          await tx.ticketPriceTier.create({
            data: {
              ticketTypeId: createdTt.id,
              name: tier.name,
              price: tier.price,
              quantityFrom: tier.quantityFrom,
              quantityTo: tier.quantityTo,
              sortOrder: tier.sortOrder,
            },
          });
        }
      }

      return event;
    });

    await writeAuditLog({
      actorId,
      organizationId: created.organizationId,
      action: "EVENT_DUPLICATED",
      entityType: "Event",
      entityId: created.id,
      metadata: { sourceId, slug: created.slug },
    });

    return created;
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

  /** Pass `null` for SUPER_ADMIN platform-wide aggregation across all organizations. */
  static async getOrgDashboardStats(organizationId: string | null) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const orgFilter = organizationId ? { organizationId } : {};
    const eventOrgFilter = organizationId ? { organizationId } : {};

    const orders = await prisma.order.findMany({
      where: {
        ...orgFilter,
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
        event: eventOrgFilter,
        status: { in: ["VALID", "CHECKED_IN", "TRANSFERRED"] },
      },
    });
    const checkedIn = await prisma.ticket.count({
      where: { event: eventOrgFilter, status: "CHECKED_IN" },
    });

    const activeReservations = await prisma.ticketReservation.count({
      where: {
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
        event: eventOrgFilter,
      },
    });

    const refundsAgg = await prisma.refund.aggregate({
      where: { order: orgFilter, status: "SUCCEEDED" },
      _sum: { amount: true },
      _count: true,
    });

    const failedPayments = orders.filter((o) => o.paymentStatus === PaymentStatus.FAILED).length;

    const pageViews = await prisma.analyticsEvent.count({
      where: { type: "PAGE_VIEW", event: eventOrgFilter },
    });
    const checkoutStarts = await prisma.analyticsEvent.count({
      where: { type: "CHECKOUT_STARTED", event: eventOrgFilter },
    });
    const conversion =
      pageViews > 0 ? Math.round((paid.length / pageViews) * 1000) / 10 : null;

    const events = await prisma.event.findMany({
      where: eventOrgFilter,
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
