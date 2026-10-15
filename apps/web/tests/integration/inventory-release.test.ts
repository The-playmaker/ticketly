import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, PaymentStatus, ReservationStatus } from "@prisma/client";
import { ReservationService } from "@/services/reservation-service";
import { InventoryService } from "@/services/inventory-service";
import { OrderService } from "@/services/order-service";

/**
 * Exact launch scenario §43:
 * Capacity 500, released 50 @ 24900
 * Sell 45, reserve 5 → buy #51 fails
 * Reduce to 40 fails
 * Expire 3 reservations → available 3
 * Release +50 → released 100
 * New price 29900; existing reservations keep 24900
 */
const prisma = new PrismaClient();

describe("inventory release + price lock", () => {
  let eventId: string;
  let organizationId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";
    process.env.STRIPE_MOCK_MODE = "true";

    const org = await prisma.organization.findFirst();
    if (!org) throw new Error("Seed org missing");
    organizationId = org.id;

    const event = await prisma.event.create({
      data: {
        organizationId,
        sellerOrganizationId: organizationId,
        name: `Launch Inv ${Date.now()}`,
        slug: `launch-inv-${Date.now()}`,
        startsAt: new Date(Date.now() + 7 * 86400_000),
        endsAt: new Date(Date.now() + 7 * 86400_000 + 3 * 3600_000),
        timezone: "Europe/Oslo",
        capacity: 500,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        currency: "NOK",
        serviceFee: 0,
        city: "Oslo",
      },
    });
    eventId = event.id;

    const tt = await prisma.ticketType.create({
      data: {
        eventId,
        name: "Ordinær",
        price: 24900,
        quantityTotal: 500,
        quantityReleased: 50,
        quantitySold: 0,
        quantityReserved: 0,
        maxPerOrder: 6,
        minPerOrder: 1,
        isVisible: true,
        isPubliclyPurchasable: true,
      },
    });
    ticketTypeId = tt.id;
  });

  afterAll(async () => {
    await prisma.ticketReservation.deleteMany({ where: { eventId } });
    await prisma.orderItem.deleteMany({ where: { order: { eventId } } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.priceHistory.deleteMany({ where: { ticketTypeId } });
    await prisma.ticketType.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("enforces released inventory and price snapshots", async () => {
    // Simulate 45 sold by bumping counters + creating paid orders is heavy;
    // set sold=45 directly under lock semantics for inventory gate testing.
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantitySold: 45, quantityReleased: 50, quantityReserved: 0 },
    });

    // 5 active reservations
    const sessions = Array.from({ length: 5 }, (_, i) => `inv-res-${Date.now()}-${i}`);
    for (const sessionId of sessions) {
      await ReservationService.reserve({
        eventId,
        sessionId,
        items: [{ ticketTypeId, quantity: 1 }],
      });
    }

    let tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(5);
    expect(tt.quantityReleased - tt.quantitySold - tt.quantityReserved).toBe(0);

    // Ticket 51 must fail
    await expect(
      ReservationService.reserve({
        eventId,
        sessionId: `inv-overflow-${Date.now()}`,
        items: [{ ticketTypeId, quantity: 1 }],
      })
    ).rejects.toBeTruthy();

    // Reduce released to 40 must fail (min = 45+5 = 50)
    await expect(
      InventoryService.reduceReleased({ ticketTypeId, newReleased: 40 })
    ).rejects.toBeTruthy();

    // Expire 3 reservations
    const active = await prisma.ticketReservation.findMany({
      where: { ticketTypeId, status: ReservationStatus.ACTIVE },
      take: 3,
    });
    for (const r of active) {
      await prisma.ticketReservation.update({
        where: { id: r.id },
        data: { status: ReservationStatus.EXPIRED, expiresAt: new Date(Date.now() - 1000) },
      });
      await prisma.ticketType.update({
        where: { id: ticketTypeId },
        data: { quantityReserved: { decrement: r.quantity } },
      });
    }

    tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(2);
    expect(tt.quantityReleased - tt.quantitySold - tt.quantityReserved).toBe(3);

    // Release another 50 → released 100
    await InventoryService.releaseMore({ ticketTypeId, amount: 50 });
    tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReleased).toBe(100);

    // Capture remaining reservation snapshots before price change
    const kept = await prisma.ticketReservation.findMany({
      where: { ticketTypeId, status: ReservationStatus.ACTIVE },
    });
    expect(kept.length).toBe(2);
    for (const r of kept) {
      expect(r.unitPriceSnapshot).toBe(24900);
    }

    await InventoryService.changePrice({
      ticketTypeId,
      newPrice: 29900,
      reason: "Next release",
    });

    // Existing reservations still 24900
    const keptAfter = await prisma.ticketReservation.findMany({
      where: { id: { in: kept.map((k) => k.id) } },
    });
    for (const r of keptAfter) {
      expect(r.unitPriceSnapshot).toBe(24900);
    }

    // New reservation gets 29900
    const newSession = `inv-new-price-${Date.now()}`;
    const { reservations } = await ReservationService.reserve({
      eventId,
      sessionId: newSession,
      items: [{ ticketTypeId, quantity: 1 }],
    });
    expect(reservations[0]!.unitPriceSnapshot).toBe(29900);

    // Complete order from new reservation — uses snapshot
    const order = await OrderService.createPendingOrder({
      eventId,
      sessionId: newSession,
      items: [{ ticketTypeId, quantity: 1 }],
      customer: {
        firstName: "Launch",
        lastName: "Test",
        email: `launch-${Date.now()}@example.com`,
      },
      termsAccepted: true,
    });
    // createPendingOrder re-reserves; total should reflect locked/new price path
    expect(order.total).toBeGreaterThanOrEqual(29900);
    expect(order.paymentStatus).toBe(PaymentStatus.PENDING);

    const history = await prisma.priceHistory.findMany({ where: { ticketTypeId } });
    expect(history.some((h) => h.oldPrice === 24900 && h.newPrice === 29900)).toBe(true);
  });
});
