import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DiscountType,
  OrderStatus,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { PromoService } from "@/services/promo-service";
import { OrderService } from "@/services/order-service";
import { ReservationService } from "@/services/reservation-service";

describe("promoter attribution + sales report", () => {
  let dbReady = false;
  let organizationId = "";
  let eventId = "";
  let eventSlug = "";
  let ticketTypeId = "";

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      dbReady = false;
      return;
    }

    process.env.STRIPE_MOCK_MODE = "true";
    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.APP_URL = "http://localhost:3456";
    process.env.EMAIL_PROVIDER = "console";
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";

    const org =
      (await prisma.organization.findFirst({ where: { slug: "titan-events" } })) ??
      (await prisma.organization.create({
        data: {
          name: "Promoter Test Org",
          slug: `promoter-org-${Date.now()}`,
          legalName: "Promoter Test AS",
          organizationNumber: "987654321",
        },
      }));
    organizationId = org.id;

    const startsAt = new Date(Date.now() + 72 * 3600_000);
    const event = await prisma.event.create({
      data: {
        organizationId,
        sellerOrganizationId: organizationId,
        name: "Promoter Night",
        slug: `promoter-${Date.now()}`,
        status: "PUBLISHED",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3600_000),
        doorsOpenAt: new Date(startsAt.getTime() - 3600_000),
        capacity: 100,
        timezone: "Europe/Oslo",
        city: "Oslo",
      },
    });
    eventId = event.id;
    eventSlug = event.slug;

    const tt = await prisma.ticketType.create({
      data: {
        eventId,
        name: "Standard",
        price: 25000,
        quantityTotal: 40,
        quantityReleased: 20,
        quantitySold: 0,
        quantityReserved: 0,
        isPubliclyPurchasable: true,
        maxPerOrder: 4,
        minPerOrder: 1,
      },
    });
    ticketTypeId = tt.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates TRACKING promoter with zero discount and share link", async () => {
    if (!dbReady) return;

    const promo = await PromoService.create({
      organizationId,
      code: `PROMO${Date.now().toString(36).toUpperCase()}`,
      label: "Sara Promoter",
      kind: "TRACKING",
      discountType: DiscountType.PERCENTAGE,
      discountValue: 0,
      eventId,
    });

    expect(promo.kind).toBe("TRACKING");
    expect(promo.label).toBe("Sara Promoter");
    expect(promo.discountValue).toBe(0);

    const report = await PromoService.salesReport({
      organizationId,
      eventId,
      kind: "TRACKING",
      baseUrl: "https://ticketly.test",
    });
    const row = report.find((r) => r.id === promo.id);
    expect(row).toBeTruthy();
    expect(row!.trackingPath).toBe(`/events/${eventSlug}?ref=${promo.code}`);
    expect(row!.trackingUrl).toContain(`?ref=${promo.code}`);
    expect(row!.ordersCount).toBe(0);
    expect(row!.netRevenue).toBe(0);
  });

  it("attributes paid order via promo code from ref without blocking missing ref", async () => {
    if (!dbReady) return;

    const code = `REF${Date.now().toString(36).toUpperCase()}`;
    const promo = await PromoService.create({
      organizationId,
      code,
      label: "Ref Link",
      kind: "TRACKING",
      discountType: DiscountType.FIXED,
      discountValue: 0,
      eventId,
    });

    const sessionId = `sess-promo-${Date.now()}`;
    await ReservationService.reserve({
      eventId,
      sessionId,
      items: [{ ticketTypeId, quantity: 1 }],
    });

    const order = await OrderService.createPendingOrder({
      eventId,
      sessionId,
      items: [{ ticketTypeId, quantity: 1 }],
      customer: {
        firstName: "Kari",
        lastName: "Nordmann",
        email: `kari.promo.${Date.now()}@example.com`,
      },
      promoCode: code,
      termsAccepted: true,
    });

    expect(order.promoCodeId).toBe(promo.id);

    // Missing / bogus ref must not throw
    const session2 = `sess-noref-${Date.now()}`;
    await ReservationService.reserve({
      eventId,
      sessionId: session2,
      items: [{ ticketTypeId, quantity: 1 }],
    });
    const order2 = await OrderService.createPendingOrder({
      eventId,
      sessionId: session2,
      items: [{ ticketTypeId, quantity: 1 }],
      customer: {
        firstName: "Per",
        lastName: "Hansen",
        email: `per.noref.${Date.now()}@example.com`,
      },
      promoCode: "DOESNOTEXIST999",
      termsAccepted: true,
    });
    expect(order2.promoCodeId).toBeNull();

    // Mark first order paid for sales report
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: PaymentStatus.PAID,
        orderStatus: OrderStatus.CONFIRMED,
        paidAt: new Date(),
      },
    });

    const report = await PromoService.salesReport({
      organizationId,
      eventId,
      kind: "TRACKING",
    });
    const row = report.find((r) => r.id === promo.id)!;
    expect(row.ordersCount).toBe(1);
    expect(row.grossSales).toBe(order.total);
    expect(row.netRevenue).toBe(order.total);

    // Refund accounting: SUCCEEDED refund reduces net, not gross
    await prisma.refund.create({
      data: {
        orderId: order.id,
        amount: Math.floor(order.total / 2),
        status: "SUCCEEDED",
        reason: "TEST",
        ticketIds: [],
      },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PARTIALLY_REFUNDED },
    });

    const afterRefund = await PromoService.salesReport({
      organizationId,
      eventId,
      kind: "TRACKING",
    });
    const row2 = afterRefund.find((r) => r.id === promo.id)!;
    expect(row2.grossSales).toBe(order.total);
    expect(row2.successfulRefundAmount).toBe(Math.floor(order.total / 2));
    expect(row2.netRevenue).toBe(order.total - Math.floor(order.total / 2));
  });

  it("exhausted TRACKING code does not block checkout", async () => {
    if (!dbReady) return;

    const code = `MAX${Date.now().toString(36).toUpperCase()}`;
    await PromoService.create({
      organizationId,
      code,
      kind: "TRACKING",
      discountType: DiscountType.FIXED,
      discountValue: 0,
      eventId,
      maxUses: 0,
    });

    const sessionId = `sess-max-${Date.now()}`;
    await ReservationService.reserve({
      eventId,
      sessionId,
      items: [{ ticketTypeId, quantity: 1 }],
    });

    const order = await OrderService.createPendingOrder({
      eventId,
      sessionId,
      items: [{ ticketTypeId, quantity: 1 }],
      customer: {
        firstName: "Max",
        lastName: "Out",
        email: `max.out.${Date.now()}@example.com`,
      },
      promoCode: code,
      termsAccepted: true,
    });
    expect(order.promoCodeId).toBeNull();
    expect(order.id).toBeTruthy();
  });
});
