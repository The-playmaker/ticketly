import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DiscountType,
  PaymentProviderType,
  PaymentStatus,
  WaitlistStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { OrderService, applyPromo, calculatePricing } from "@/services/order-service";
import { PromoService } from "@/services/promo-service";
import { WaitlistService } from "@/services/waitlist-service";
import { TicketService } from "@/services/ticket-service";
import { NotificationService } from "@/services/notification-service";
import { AppError } from "@/lib/api-error";
import { NotificationCategory, type Organization, type Event, type PromoCode, type TicketType } from "@prisma/client";

describe("Promo / waitlist / bundle / reminders", () => {
  let organizationId: string;
  let eventId: string;
  let ticketTypeId: string;
  let bundleTypeId: string;
  let org: Organization;
  let event: Event;
  let dbReady = false;

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
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";

    const found = await prisma.organization.findFirst({ where: { slug: "titan-events" } });
    org =
      found ??
      (await prisma.organization.create({
        data: {
          name: "Titan Events",
          slug: `titan-parity-${Date.now()}`,
          legalName: "Titan Systems AS",
          organizationNumber: "123456789",
        },
      }));
    organizationId = org.id;

    const startsAt = new Date(Date.now() + 48 * 3600_000);
    event = await prisma.event.create({
      data: {
        organizationId,
        sellerOrganizationId: organizationId,
        name: "Parity Test Night",
        slug: `parity-${Date.now()}`,
        status: "PUBLISHED",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3600_000),
        doorsOpenAt: new Date(startsAt.getTime() - 3600_000),
        capacity: 200,
        timezone: "Europe/Oslo",
        city: "Oslo",
        waitlistEnabled: true,
        reminder24hEnabled: true,
        reminder3hEnabled: false,
      },
    });
    eventId = event.id;

    const tt = await prisma.ticketType.create({
      data: {
        eventId,
        name: "Ordinær",
        price: 20000,
        quantityTotal: 50,
        quantityReleased: 20,
        quantitySold: 0,
        quantityReserved: 0,
        isPubliclyPurchasable: true,
        maxPerOrder: 6,
        minPerOrder: 1,
      },
    });
    ticketTypeId = tt.id;

    const bundle = await prisma.ticketType.create({
      data: {
        eventId,
        name: "4-pack",
        price: 89900,
        quantityTotal: 20,
        quantityReleased: 10,
        quantitySold: 0,
        quantityReserved: 0,
        isPubliclyPurchasable: true,
        maxPerOrder: 2,
        minPerOrder: 1,
        admissionCount: 4,
        isBundle: true,
      },
    });
    bundleTypeId = bundle.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("validates promo rules (expired, future, wrong event/type, usage)", async () => {
    if (!dbReady) return;

    const valid = await PromoService.create({
      organizationId,
      code: `VIP${Date.now()}`,
      discountType: DiscountType.PERCENTAGE,
      discountValue: 2000,
      eventId,
      maxUses: 2,
    });

    expect(PromoService.isApplicable(valid, { eventId, ticketTypeIds: [ticketTypeId] }).ok).toBe(
      true
    );

    const expired = await PromoService.create({
      organizationId,
      code: `EXP${Date.now()}`,
      discountType: DiscountType.FIXED,
      discountValue: 5000,
      eventId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(PromoService.isApplicable(expired, { eventId, ticketTypeIds: [ticketTypeId] }).ok).toBe(
      false
    );

    const future = await PromoService.create({
      organizationId,
      code: `FUT${Date.now()}`,
      discountType: DiscountType.PERCENTAGE,
      discountValue: 1000,
      eventId,
      startAt: new Date(Date.now() + 864e5),
    });
    expect(PromoService.isApplicable(future, { eventId, ticketTypeIds: [ticketTypeId] }).ok).toBe(
      false
    );

    const wrongEvent = await PromoService.isApplicable(valid, {
      eventId: "other-event",
      ticketTypeIds: [ticketTypeId],
    });
    expect(wrongEvent.ok).toBe(false);

    const typed = await PromoService.create({
      organizationId,
      code: `TT${Date.now()}`,
      discountType: DiscountType.PERCENTAGE,
      discountValue: 1000,
      eventId,
      ticketTypeId,
    });
    expect(
      PromoService.isApplicable(typed, { eventId, ticketTypeIds: [bundleTypeId] }).ok
    ).toBe(false);
    expect(
      PromoService.isApplicable(typed, { eventId, ticketTypeIds: [ticketTypeId] }).ok
    ).toBe(true);

    const pricing = calculatePricing({
      organization: org,
      event,
      ticketTypes: [
        (await prisma.ticketType.findUniqueOrThrow({
          where: { id: ticketTypeId },
          include: { priceTiers: true },
        })) as TicketType & { priceTiers: [] },
      ],
      items: [{ ticketTypeId, quantity: 2 }],
      promo: valid,
    });
    expect(pricing.discount).toBe(Math.round((40000 * 2000) / 10000));
    expect(pricing.total).toBeLessThan(pricing.subtotal + pricing.serviceFee);
  });

  it("enforces concurrent last promo redemption (max 1 of last use)", async () => {
    if (!dbReady) return;

    const promo = await PromoService.create({
      organizationId,
      code: `LAST${Date.now()}`,
      discountType: DiscountType.FIXED,
      discountValue: 1000,
      eventId,
      maxUses: 1,
    });

    const sessions = [`s-a-${Date.now()}`, `s-b-${Date.now()}`];
    const results = await Promise.allSettled(
      sessions.map((sessionId) =>
        OrderService.createPendingOrder({
          eventId,
          sessionId,
          items: [{ ticketTypeId, quantity: 1 }],
          customer: {
            firstName: "Race",
            lastName: "Promo",
            email: `race-${sessionId}@example.com`,
          },
          promoCode: promo.code,
          termsAccepted: true,
        })
      )
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);

    const refreshed = await prisma.promoCode.findUniqueOrThrow({ where: { id: promo.id } });
    expect(refreshed.usedCount).toBe(1);
  });

  it("waitlist join, invite, claim, expire", async () => {
    if (!dbReady) return;

    const join = await WaitlistService.join({
      eventId,
      ticketTypeId,
      email: "wait@example.com",
      name: "Wait Person",
      requestedQuantity: 2,
    });
    expect(join.created).toBe(true);
    expect(join.entry.status).toBe(WaitlistStatus.WAITING);

    const dup = await WaitlistService.join({
      eventId,
      ticketTypeId,
      email: "wait@example.com",
      requestedQuantity: 2,
    });
    expect(dup.created).toBe(false);

    const invited = await WaitlistService.inviteNext(eventId, 1, {
      organizationId,
      ttlMinutes: 30,
    });
    expect(invited.length).toBe(1);
    expect(invited[0]!.status).toBe(WaitlistStatus.INVITED);
    expect(invited[0]!.inviteToken).toBeTruthy();

    const claimed = await WaitlistService.claimInvite(invited[0]!.inviteToken!);
    expect(claimed.status).toBe(WaitlistStatus.CLAIMED);

    // Expired invite
    const join2 = await WaitlistService.join({
      eventId,
      email: "expire@example.com",
      name: "Expire",
    });
    const token = "expired_token_" + Date.now();
    await prisma.waitlistEntry.update({
      where: { id: join2.entry.id },
      data: {
        status: WaitlistStatus.INVITED,
        inviteToken: token,
        inviteExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(WaitlistService.claimInvite(token)).rejects.toBeInstanceOf(AppError);
  });

  it("bundle order issues admissionCount individual tickets", async () => {
    if (!dbReady) return;

    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-BUNDLE-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "bundle@example.com",
        customerFirstName: "Bundle",
        customerLastName: "Buyer",
        subtotal: 89900,
        total: 89900,
        currency: "NOK",
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: bundleTypeId,
            quantity: 1,
            unitPrice: 89900,
            total: 89900,
            name: "4-pack",
          },
        },
        payments: {
          create: {
            provider: PaymentProviderType.STRIPE,
            providerPaymentId: `pi_bundle_${Date.now()}`,
            amount: 89900,
            currency: "NOK",
            status: PaymentStatus.PAID,
          },
        },
      },
    });

    // Simulate reserved inventory for issuance path
    await prisma.ticketType.update({
      where: { id: bundleTypeId },
      data: { quantityReserved: { increment: 1 } },
    });

    const tickets = await TicketService.issueTicketsForPaidOrder(order.id);
    expect(tickets.length).toBe(4);
    expect(new Set(tickets.map((t) => t.publicId)).size).toBe(4);

    const again = await TicketService.issueTicketsForPaidOrder(order.id);
    expect(again.length).toBe(4);
  });

  it("schedules reminders only once for eligible paid orders", async () => {
    if (!dbReady) return;

    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-REM-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "remind@example.com",
        customerFirstName: "Rem",
        customerLastName: "Inder",
        subtotal: 20000,
        total: 20000,
        currency: "NOK",
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
      },
    });

    const first = await NotificationService.scheduleEventReminders(eventId);
    const second = await NotificationService.scheduleEventReminders(eventId);
    expect(first.scheduled).toBeGreaterThanOrEqual(1);
    // Second call upserts — count of SCHEDULED jobs for this order/kind stays unique
    const jobs = await prisma.eventReminderJob.findMany({
      where: { eventId, orderId: order.id },
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0]!.kind).toBe("EVENT_24H");
    expect(second.scheduled).toBeGreaterThanOrEqual(1);

    // Marketing prefs must not block transactional path — logAndSend uses TRANSACTIONAL/SERVICE
    const send = await NotificationService.logAndSend({
      to: order.customerEmail,
      subject: "Ticket confirmation",
      html: "<p>Your tickets</p>",
      category: NotificationCategory.TRANSACTIONAL,
      orderId: order.id,
      eventId,
    });
    expect(send.ok).toBe(true);
  });

  it("applyPromo percentage and fixed include discount in snapshot math", () => {
    const promoPct = {
      id: "p",
      organizationId: "o",
      eventId: null,
      ticketTypeId: null,
      code: "X",
      discountType: DiscountType.PERCENTAGE,
      discountValue: 2000,
      maxUses: null,
      usedCount: 0,
      startAt: null,
      expiresAt: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PromoCode;
    expect(applyPromo(promoPct, 10000)).toBe(2000);

    const promoFixed = { ...promoPct, discountType: DiscountType.FIXED, discountValue: 5000 };
    expect(applyPromo(promoFixed, 10000)).toBe(5000);
    expect(applyPromo(promoFixed, 3000)).toBe(3000);
  });
});
