import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PrismaClient,
  PaymentStatus,
  ReservationStatus,
  OrderStatus,
} from "@prisma/client";
import {
  ReservationService,
  getAvailableQuantity,
  paymentGraceMinutes,
  resetReservationCleanupThrottle,
} from "@/services/reservation-service";

const prisma = new PrismaClient();

describe("reservation repair + inventory rebuild", () => {
  let eventId: string;
  let organizationId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";
    process.env.PAYMENT_GRACE_MINUTES = "15";

    const org = await prisma.organization.findFirst();
    if (!org) throw new Error("Seed org missing");
    organizationId = org.id;

    const event = await prisma.event.create({
      data: {
        organizationId,
        sellerOrganizationId: organizationId,
        name: `Res Repair ${Date.now()}`,
        slug: `res-repair-${Date.now()}`,
        startsAt: new Date(Date.now() + 7 * 86400_000),
        endsAt: new Date(Date.now() + 7 * 86400_000 + 3 * 3600_000),
        timezone: "Europe/Oslo",
        capacity: 100,
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
        quantityTotal: 100,
        quantityReleased: 50,
        quantitySold: 40,
        quantityReserved: 0,
        maxPerOrder: 6,
        minPerOrder: 1,
        isVisible: true,
        isPubliclyPurchasable: true,
      },
    });
    ticketTypeId = tt.id;
  });

  beforeEach(async () => {
    resetReservationCleanupThrottle();
    await prisma.ticketReservation.deleteMany({ where: { eventId } });
    await prisma.orderItem.deleteMany({ where: { order: { eventId } } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: {
        quantitySold: 40,
        quantityReleased: 50,
        quantityReserved: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.ticketReservation.deleteMany({ where: { eventId } });
    await prisma.orderItem.deleteMany({ where: { order: { eventId } } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.ticketType.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function seedStaleAbandoned(count: number, qtyEach = 1) {
    const pastGrace = new Date(
      Date.now() - (paymentGraceMinutes() + 5) * 60_000
    );
    for (let i = 0; i < count; i++) {
      await prisma.ticketReservation.create({
        data: {
          eventId,
          ticketTypeId,
          quantity: qtyEach,
          sessionId: `stale-${Date.now()}-${i}`,
          status: ReservationStatus.ACTIVE,
          expiresAt: pastGrace,
        },
      });
    }
    // Simulate stale counter that was never released
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: count * qtyEach },
    });
  }

  it("expires abandoned ACTIVE past grace and rebuilds quantityReserved", async () => {
    await seedStaleAbandoned(6);
    let tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(6);
    expect(getAvailableQuantity(tt)).toBe(4); // 50-40-6

    const dry = await ReservationService.repairEvent({ eventId, apply: false });
    expect(dry.dryRun).toBe(true);
    expect(dry.expiredCount).toBe(6);
    const row = dry.types.find((t) => t.ticketTypeId === ticketTypeId)!;
    expect(row.currentQuantityReserved).toBe(6);
    expect(row.activeTotal).toBe(6);
    expect(row.activeUnexpiredTotal).toBe(0);
    expect(row.proposedQuantityReserved).toBe(0);
    expect(row.delta).toBe(-6);
    expect(row.availableAfter).toBe(10);

    // Dry-run must not mutate
    tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(6);
    const stillActive = await prisma.ticketReservation.count({
      where: { eventId, status: ReservationStatus.ACTIVE },
    });
    expect(stillActive).toBe(6);

    const applied = await ReservationService.repairEvent({ eventId, apply: true });
    expect(applied.applied).toBe(true);
    expect(applied.expiredCount).toBe(6);

    tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(0);
    expect(tt.quantitySold).toBe(40); // untouched
    expect(getAvailableQuantity(tt)).toBe(10);

    const expired = await prisma.ticketReservation.count({
      where: { eventId, status: ReservationStatus.EXPIRED },
    });
    expect(expired).toBe(6);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "INVENTORY_RESERVATION_REPAIR", entityId: eventId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("rebuilds quantityReserved from ACTIVE unexpired truth (stale high counter)", async () => {
    const future = new Date(Date.now() + 10 * 60_000);
    await prisma.ticketReservation.create({
      data: {
        eventId,
        ticketTypeId,
        quantity: 2,
        sessionId: `live-${Date.now()}`,
        status: ReservationStatus.ACTIVE,
        expiresAt: future,
      },
    });
    // Counter wrongly inflated (orphaned increments)
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: 12 },
    });

    const result = await ReservationService.repairEvent({ eventId, apply: true });
    const row = result.types.find((t) => t.ticketTypeId === ticketTypeId)!;
    expect(row.proposedQuantityReserved).toBe(2);
    expect(row.delta).toBe(-10);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(2);
    expect(getAvailableQuantity(tt)).toBe(8); // 50-40-2
  });

  it("does not release reservation tied to PAID order", async () => {
    const past = new Date(Date.now() - 60 * 60_000);
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-REPAIR-PAID-${Date.now()}`,
        organizationId,
        sellerOrganizationId: organizationId,
        eventId,
        customerEmail: `paid-${Date.now()}@example.com`,
        customerFirstName: "Paid",
        customerLastName: "Buyer",
        subtotal: 24900,
        total: 24900,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: OrderStatus.CONFIRMED,
        paidAt: new Date(),
      },
    });

    await prisma.ticketReservation.create({
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        sessionId: `paid-res-${Date.now()}`,
        status: ReservationStatus.ACTIVE,
        expiresAt: past,
        orderId: order.id,
      },
    });
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: 1 },
    });

    await ReservationService.repairEvent({ eventId, apply: true });

    const res = await prisma.ticketReservation.findFirst({
      where: { orderId: order.id },
    });
    expect(res?.status).toBe(ReservationStatus.ACTIVE);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    // PAID hold still counts toward reserved (fulfillment owns release)
    expect(tt.quantityReserved).toBe(1);
    expect(tt.quantitySold).toBe(40);
  });

  it("releases abandoned PENDING older than payment grace", async () => {
    const pastGrace = new Date(
      Date.now() - (paymentGraceMinutes() + 10) * 60_000
    );
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-REPAIR-PEND-${Date.now()}`,
        organizationId,
        sellerOrganizationId: organizationId,
        eventId,
        customerEmail: `pend-${Date.now()}@example.com`,
        customerFirstName: "Pend",
        customerLastName: "Buyer",
        subtotal: 24900,
        total: 24900,
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: OrderStatus.PENDING,
      },
    });

    await prisma.ticketReservation.create({
      data: {
        eventId,
        ticketTypeId,
        quantity: 3,
        sessionId: `pend-res-${Date.now()}`,
        status: ReservationStatus.ACTIVE,
        expiresAt: pastGrace,
        orderId: order.id,
      },
    });
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: 3 },
    });

    await ReservationService.repairEvent({ eventId, apply: true });

    const res = await prisma.ticketReservation.findFirst({
      where: { orderId: order.id },
    });
    expect(res?.status).toBe(ReservationStatus.EXPIRED);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(0);
    expect(getAvailableQuantity(tt)).toBe(10);
  });

  it("holds PENDING within payment grace (no oversell window)", async () => {
    const withinGrace = new Date(Date.now() - 2 * 60_000); // expired 2 min ago
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-REPAIR-GRACE-${Date.now()}`,
        organizationId,
        sellerOrganizationId: organizationId,
        eventId,
        customerEmail: `grace-${Date.now()}@example.com`,
        customerFirstName: "Grace",
        customerLastName: "Buyer",
        subtotal: 24900,
        total: 24900,
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: OrderStatus.PENDING,
      },
    });

    await prisma.ticketReservation.create({
      data: {
        eventId,
        ticketTypeId,
        quantity: 2,
        sessionId: `grace-res-${Date.now()}`,
        status: ReservationStatus.ACTIVE,
        expiresAt: withinGrace,
        orderId: order.id,
      },
    });
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: 2 },
    });

    const result = await ReservationService.repairEvent({ eventId, apply: true });
    expect(result.expiredCount).toBe(0);

    const res = await prisma.ticketReservation.findFirst({
      where: { orderId: order.id },
    });
    expect(res?.status).toBe(ReservationStatus.ACTIVE);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(2);
  });

  it("repeated repair is idempotent", async () => {
    await seedStaleAbandoned(4);
    const first = await ReservationService.repairEvent({ eventId, apply: true });
    expect(first.expiredCount).toBe(4);

    const tt1 = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt1.quantityReserved).toBe(0);

    const second = await ReservationService.repairEvent({ eventId, apply: true });
    expect(second.expiredCount).toBe(0);
    expect(second.types.every((t) => t.delta === 0)).toBe(true);

    const tt2 = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt2.quantityReserved).toBe(0);
    expect(tt2.quantitySold).toBe(40);
  });

  it("available increases and new reserve succeeds without oversell", async () => {
    // Live-bug shape: sold 40, reserved counter 10 (all abandoned), available 0
    await seedStaleAbandoned(10);
    let tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(getAvailableQuantity(tt)).toBe(0);

    await ReservationService.repairEvent({ eventId, apply: true });
    tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(getAvailableQuantity(tt)).toBe(10);

    // Can reserve up to available, not more
    const { reservations } = await ReservationService.reserve({
      eventId,
      sessionId: `after-repair-${Date.now()}`,
      items: [{ ticketTypeId, quantity: 5 }],
    });
    expect(reservations).toHaveLength(1);

    tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(5);
    expect(getAvailableQuantity(tt)).toBe(5);

    await expect(
      ReservationService.reserve({
        eventId,
        sessionId: `oversell-${Date.now()}`,
        items: [{ ticketTypeId, quantity: 6 }],
      })
    ).rejects.toMatchObject({ code: "TICKET_SOLD_OUT" });
  });

  it("does not count CONVERTED / RELEASED / EXPIRED toward reserved", async () => {
    const future = new Date(Date.now() + 10 * 60_000);
    await prisma.ticketReservation.createMany({
      data: [
        {
          eventId,
          ticketTypeId,
          quantity: 1,
          sessionId: `keep-${Date.now()}`,
          status: ReservationStatus.ACTIVE,
          expiresAt: future,
        },
        {
          eventId,
          ticketTypeId,
          quantity: 5,
          sessionId: `conv-${Date.now()}`,
          status: ReservationStatus.CONVERTED,
          expiresAt: future,
        },
        {
          eventId,
          ticketTypeId,
          quantity: 3,
          sessionId: `rel-${Date.now()}`,
          status: ReservationStatus.RELEASED,
          expiresAt: future,
        },
        {
          eventId,
          ticketTypeId,
          quantity: 2,
          sessionId: `exp-${Date.now()}`,
          status: ReservationStatus.EXPIRED,
          expiresAt: new Date(Date.now() - 1000),
        },
      ],
    });
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: 99 },
    });

    await ReservationService.repairEvent({ eventId, apply: true });
    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(1);
  });

  it("opportunistic cleanup skips under throttle; sales path still repairs drift", async () => {
    const future = new Date(Date.now() + 10 * 60_000);
    await prisma.ticketReservation.create({
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        sessionId: `inv-${Date.now()}`,
        status: ReservationStatus.ACTIVE,
        expiresAt: future,
      },
    });
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: 1 },
    });

    // Prime throttle with a clean pass
    const clean = await ReservationService.cleanupEventSafe(eventId, { force: true });
    expect(clean?.types.every((t) => t.delta === 0)).toBe(true);

    // Inject drift while throttle window is active
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: 25 },
    });

    const invariant = await ReservationService.checkQuantityReservedInvariant(eventId);
    expect(invariant.needsRepair).toBe(true);
    expect(invariant.types.find((t) => t.ticketTypeId === ticketTypeId)?.delta).toBe(-24);

    // Public/opportunistic path must not block every page view during throttle
    const skipped = await ReservationService.cleanupEventSafe(eventId);
    expect(skipped).toBeNull();
    const stillDrifted = await prisma.ticketType.findUniqueOrThrow({
      where: { id: ticketTypeId },
    });
    expect(stillDrifted.quantityReserved).toBe(25);

    // Sales path always cheap-checks + repairs — never leave drift for checkout
    const repaired = await ReservationService.ensureInventoryConsistent(eventId);
    expect(repaired?.applied).toBe(true);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(1);
    expect(getAvailableQuantity(tt)).toBe(9);
  });

  it("cleanupStaleReservations finds pure counter drift without expired ACTIVE", async () => {
    const future = new Date(Date.now() + 10 * 60_000);
    await prisma.ticketReservation.create({
      data: {
        eventId,
        ticketTypeId,
        quantity: 2,
        sessionId: `drift-batch-${Date.now()}`,
        status: ReservationStatus.ACTIVE,
        expiresAt: future,
      },
    });
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: 40 },
    });

    const batch = await ReservationService.cleanupStaleReservations({
      force: true,
      limit: 50,
    });
    expect(batch.events.some((e) => e.eventId === eventId)).toBe(true);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(2);
  });

  it("repeated cleanupEventSafe is idempotent", async () => {
    await seedStaleAbandoned(3);
    const first = await ReservationService.cleanupEventSafe(eventId, { force: true });
    expect(first?.applied).toBe(true);
    expect(first?.expiredCount).toBe(3);

    resetReservationCleanupThrottle();
    const second = await ReservationService.cleanupEventSafe(eventId, { force: true });
    expect(second?.expiredCount).toBe(0);
    expect(second?.types.every((t) => t.delta === 0)).toBe(true);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(0);
  });
});
