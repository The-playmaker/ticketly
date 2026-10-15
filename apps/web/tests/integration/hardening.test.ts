import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaClient,
  PaymentStatus,
  TicketStatus,
  PaymentProviderType,
  EventStatus,
} from "@prisma/client";
import { ReservationService } from "@/services/reservation-service";
import { CheckInService } from "@/services/check-in-service";
import { PaymentService } from "@/services/payment-service";
import { calculatePricing } from "@/services/order-service";
import { TicketService } from "@/services/ticket-service";
import { RefundService } from "@/services/refund-service";
import {
  generateSecureToken,
  generatePublicTicketId,
  hashTicketToken,
  encryptTicketToken,
} from "@/lib/tickets/token";
import { assertTicketTransition, IllegalTicketTransitionError } from "@/services/ticket-state-machine";
import { AppError } from "@/lib/api-error";

const prisma = new PrismaClient();

describe("hardening: pricing, concurrency, webhooks, QR, tenancy", () => {
  let eventId: string;
  let organizationId: string;
  let vipTypeId: string;
  let guestTypeId: string;
  let capacity1TypeId: string;
  let capacity10TypeId: string;

  beforeAll(async () => {
    process.env.STRIPE_MOCK_MODE = "true";
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";

    const event = await prisma.event.findFirst({
      where: { slug: "friday-night" },
      include: { ticketTypes: true, organization: true },
    });
    if (!event) throw new Error("Seed data missing — run npm run db:seed");
    eventId = event.id;
    organizationId = event.organizationId;

    const vip = event.ticketTypes.find((t) => t.name === "VIP");
    if (!vip) throw new Error("VIP ticket type missing");
    vipTypeId = vip.id;

    let guest = event.ticketTypes.find((t) => t.name === "Guest List");
    if (!guest) {
      guest = await prisma.ticketType.create({
        data: {
          eventId,
          name: "Guest List",
          price: 0,
          quantityTotal: 50,
          quantityReleased: 0,
          isVisible: false,
          isPubliclyPurchasable: false,
          sortOrder: 99,
        },
      });
    } else if (guest.isPubliclyPurchasable) {
      guest = await prisma.ticketType.update({
        where: { id: guest.id },
        data: { isPubliclyPurchasable: false },
      });
    }
    guestTypeId = guest.id;

    const c1 = await prisma.ticketType.create({
      data: {
        eventId,
        name: `Cap1-${Date.now()}`,
        price: 10000,
        quantityTotal: 1,
        quantityReleased: 1,
        maxPerOrder: 1,
        isVisible: false,
        isPubliclyPurchasable: true,
        sortOrder: 90,
      },
    });
    capacity1TypeId = c1.id;

    const c10 = await prisma.ticketType.create({
      data: {
        eventId,
        name: `Cap10-${Date.now()}`,
        price: 5000,
        quantityTotal: 10,
        quantityReleased: 10,
        maxPerOrder: 1,
        isVisible: false,
        isPubliclyPurchasable: true,
        sortOrder: 91,
      },
    });
    capacity10TypeId = c10.id;
  });

  afterAll(async () => {
    await prisma.ticketReservation.deleteMany({
      where: { ticketTypeId: { in: [capacity1TypeId, capacity10TypeId] } },
    });
    await prisma.checkIn.deleteMany({
      where: { ticket: { ticketTypeId: { in: [capacity1TypeId, capacity10TypeId] } } },
    });
    await prisma.ticket.deleteMany({
      where: { ticketTypeId: { in: [capacity1TypeId, capacity10TypeId] } },
    });
    await prisma.orderItem.deleteMany({
      where: { ticketTypeId: { in: [capacity1TypeId, capacity10TypeId, guestTypeId] } },
    });
    await prisma.webhookEvent.deleteMany({
      where: { eventId: { startsWith: "evt_hard_" } },
    }).catch(() => undefined);
    await prisma.ticketType.deleteMany({
      where: { id: { in: [capacity1TypeId, capacity10TypeId] } },
    }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("server pricing ignores client price — VIP stays DB price", async () => {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: { organization: true },
    });
    const vip = await prisma.ticketType.findUniqueOrThrow({
      where: { id: vipTypeId },
      include: { priceTiers: true },
    });
    const pricing = calculatePricing({
      organization: event.organization,
      event,
      ticketTypes: [vip],
      items: [{ ticketTypeId: vipTypeId, quantity: 1 }],
    });
    expect(pricing.lines[0]!.unitPrice).toBe(vip.price);
    expect(pricing.total).toBeGreaterThan(100);
    expect(pricing.serviceFee).toBeGreaterThan(0);
  });

  it("rejects non-publicly-purchasable guest ticket type", async () => {
    await expect(
      ReservationService.reserve({
        eventId,
        sessionId: `guest-attack-${Date.now()}`,
        items: [{ ticketTypeId: guestTypeId, quantity: 1 }],
      })
    ).rejects.toThrow(/offentlig|FREE_TICKET|403|kan ikke/i);
  });

  it("20 concurrent reservations for capacity 1 → exactly 1 success", async () => {
    // reset type
    await prisma.ticketReservation.updateMany({
      where: { ticketTypeId: capacity1TypeId, status: "ACTIVE" },
      data: { status: "RELEASED" },
    });
    await prisma.ticketType.update({
      where: { id: capacity1TypeId },
      data: { quantityReserved: 0, quantitySold: 0 },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        ReservationService.reserve({
          eventId,
          sessionId: `race20-${Date.now()}-${i}`,
          items: [{ ticketTypeId: capacity1TypeId, quantity: 1 }],
        })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(19);
    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: capacity1TypeId } });
    expect(tt.quantityReserved).toBe(1);
  });

  it("50 concurrent reservations for capacity 10 → max 10 reserved", async () => {
    await prisma.ticketReservation.updateMany({
      where: { ticketTypeId: capacity10TypeId, status: "ACTIVE" },
      data: { status: "RELEASED" },
    });
    await prisma.ticketType.update({
      where: { id: capacity10TypeId },
      data: { quantityReserved: 0, quantitySold: 0 },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        ReservationService.reserve({
          eventId,
          sessionId: `race50-${Date.now()}-${i}`,
          items: [{ ticketTypeId: capacity10TypeId, quantity: 1 }],
        })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBe(10);
    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: capacity10TypeId } });
    expect(tt.quantityReserved).toBe(10);
    expect(tt.quantityReserved + tt.quantitySold).toBeLessThanOrEqual(tt.quantityTotal);
  });

  it("rejects invalid quantities", async () => {
    await expect(
      ReservationService.reserve({
        eventId,
        sessionId: `neg-${Date.now()}`,
        items: [{ ticketTypeId: vipTypeId, quantity: -1 }],
      })
    ).rejects.toBeTruthy();
    await expect(
      ReservationService.reserve({
        eventId,
        sessionId: `huge-${Date.now()}`,
        items: [{ ticketTypeId: vipTypeId, quantity: 99999 }],
      })
    ).rejects.toBeTruthy();
  });

  it("webhook amount mismatch marks anomaly and does not issue tickets", async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-AMT-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "amt@example.com",
        customerFirstName: "Amt",
        customerLastName: "Test",
        subtotal: 49900,
        serviceFee: 2000,
        total: 51900,
        currency: "NOK",
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: "PENDING",
        items: {
          create: {
            ticketTypeId: vipTypeId,
            quantity: 1,
            unitPrice: 49900,
            serviceFee: 2000,
            total: 51900,
            name: "VIP",
          },
        },
      },
    });

    await expect(
      PaymentService.handleProviderWebhook({
        provider: PaymentProviderType.STRIPE,
        rawBody: JSON.stringify({
          id: `evt_hard_amt_${order.id}`,
          type: "checkout.session.completed",
          orderId: order.id,
          sessionId: `cs_amt_${order.id}`,
          paymentId: `pi_amt_${order.id}`,
          amount: 100,
          currency: "NOK",
        }),
        signature: "mock",
      })
    ).rejects.toBeTruthy();

    const refreshed = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: true },
    });
    expect(refreshed.paymentAnomaly).toBe(true);
    expect(refreshed.tickets.length).toBe(0);
    expect(refreshed.paymentStatus).not.toBe(PaymentStatus.PAID);
  });

  it("duplicate webhook is idempotent", async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-DUP-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "dup@example.com",
        customerFirstName: "Dup",
        customerLastName: "Hook",
        subtotal: 0,
        total: 0,
        currency: "NOK",
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: "PENDING",
        items: {
          create: {
            ticketTypeId: capacity10TypeId,
            quantity: 1,
            unitPrice: 0,
            total: 0,
            name: "FreePublic",
          },
        },
      },
    });
    // ensure type publicly purchasable at 0 for free path via markOrderPaid amount 0
    await prisma.ticketType.update({
      where: { id: capacity10TypeId },
      data: { price: 0 },
    });

    const payload = JSON.stringify({
      id: `evt_hard_dup_${order.id}`,
      type: "checkout.session.completed",
      orderId: order.id,
      sessionId: `cs_dup_${order.id}`,
      paymentId: `pi_dup_${order.id}`,
      amount: 0,
      currency: "NOK",
    });

    const first = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: payload,
      signature: "mock",
    });
    const second = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: payload,
      signature: "mock",
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it("check-in by tokenHash is atomic under concurrency", async () => {
    const raw = generateSecureToken();
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-QR-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "qr@example.com",
        customerFirstName: "Qr",
        customerLastName: "Test",
        subtotal: 1000,
        total: 1000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: capacity10TypeId,
            quantity: 1,
            unitPrice: 1000,
            total: 1000,
            name: "QR",
          },
        },
      },
      include: { items: true },
    });
    await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(raw),
        tokenCipher: encryptTicketToken(raw),
        secureToken: null,
        orderId: order.id,
        orderItemId: order.items[0]!.id,
        eventId,
        ticketTypeId: capacity10TypeId,
        holderName: "Qr Test",
        holderEmail: "qr@example.com",
        status: TicketStatus.VALID,
      },
    });

    const [a, b] = await Promise.all([
      CheckInService.checkInByToken({ token: raw, eventId }),
      CheckInService.checkInByToken({ token: raw, eventId }),
    ]);
    const successes = [a, b].filter((r) => r.result === "SUCCESS");
    const already = [a, b].filter((r) => r.result === "ALREADY_USED");
    expect(successes.length).toBe(1);
    expect(already.length).toBe(1);
  });

  it("transfer invalidates old QR token", async () => {
    const raw = generateSecureToken();
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-XFER-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "xfer@example.com",
        customerFirstName: "Xfer",
        customerLastName: "Test",
        subtotal: 1000,
        total: 1000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: capacity10TypeId,
            quantity: 1,
            unitPrice: 1000,
            total: 1000,
            name: "Xfer",
          },
        },
      },
      include: { items: true },
    });
    const ticket = await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(raw),
        tokenCipher: encryptTicketToken(raw),
        orderId: order.id,
        orderItemId: order.items[0]!.id,
        eventId,
        ticketTypeId: capacity10TypeId,
        holderName: "Xfer Test",
        holderEmail: "xfer@example.com",
        status: TicketStatus.VALID,
      },
    });

    await TicketService.transferTicket({
      ticketId: ticket.id,
      toName: "New Holder",
      toEmail: "new@example.com",
    });

    const oldScan = await CheckInService.checkInByToken({ token: raw, eventId });
    expect(oldScan.result).toBe("INVALID");
  });

  it("refunded ticket cannot check in", async () => {
    const raw = generateSecureToken();
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-RF2-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "rf2@example.com",
        customerFirstName: "Rf",
        customerLastName: "Two",
        subtotal: 1000,
        total: 1000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: capacity10TypeId,
            quantity: 1,
            unitPrice: 1000,
            total: 1000,
            name: "Rf",
          },
        },
        payments: {
          create: {
            provider: "STRIPE",
            providerPaymentId: `pi_rf_${Date.now()}`,
            amount: 1000,
            currency: "NOK",
            status: PaymentStatus.PAID,
            idempotencyKey: `rf_${Date.now()}`,
          },
        },
      },
      include: { items: true },
    });
    const ticket = await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(raw),
        tokenCipher: encryptTicketToken(raw),
        orderId: order.id,
        orderItemId: order.items[0]!.id,
        eventId,
        ticketTypeId: capacity10TypeId,
        holderName: "Rf Two",
        holderEmail: "rf2@example.com",
        status: TicketStatus.VALID,
      },
    });

    await RefundService.refundOrder({ orderId: order.id, ticketIds: [ticket.id], reason: "test" });
    const result = await CheckInService.checkInByToken({ token: raw, eventId });
    expect(result.result).toBe("REFUNDED");
  });

  it("ticket state machine blocks REFUNDED → VALID", () => {
    expect(() => assertTicketTransition(TicketStatus.REFUNDED, TicketStatus.VALID)).toThrow(
      IllegalTicketTransitionError
    );
  });

  it("cancelled event blocks new reservations", async () => {
    const cancelled = await prisma.event.create({
      data: {
        organizationId,
        sellerOrganizationId: organizationId,
        name: "Cancelled Hardening",
        slug: `cancelled-${Date.now()}`,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 90000000),
        timezone: "Europe/Oslo",
        capacity: 10,
        status: EventStatus.CANCELLED,
        visibility: "PUBLIC",
        currency: "NOK",
      },
    });
    const tt = await prisma.ticketType.create({
      data: {
        eventId: cancelled.id,
        name: "Any",
        price: 1000,
        quantityTotal: 5,
        quantityReleased: 5,
        isPubliclyPurchasable: true,
      },
    });
    await expect(
      ReservationService.reserve({
        eventId: cancelled.id,
        sessionId: `cancel-${Date.now()}`,
        items: [{ ticketTypeId: tt.id, quantity: 1 }],
      })
    ).rejects.toBeTruthy();
    await prisma.ticketType.delete({ where: { id: tt.id } });
    await prisma.event.delete({ where: { id: cancelled.id } });
  });

  it("cross-tenant order access helper denies foreign org", async () => {
    const { assertCanAccessOrder } = await import("@/lib/auth/org-access");
    const foreignOrg = await prisma.organization.create({
      data: { name: "Foreign Org", slug: `foreign-${Date.now()}` },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-IDOR-${Date.now()}`,
        organizationId: foreignOrg.id,
        eventId,
        customerEmail: "idor@example.com",
        customerFirstName: "I",
        customerLastName: "Dor",
        subtotal: 0,
        total: 0,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
      },
    });
    const attacker = {
      id: "attacker",
      email: "attacker@example.com",
      name: "Attacker",
      globalRole: "CUSTOMER" as const,
      isActive: true,
      memberships: [
        {
          organizationId,
          role: "ORGANIZER_ADMIN" as const,
          canRefund: true,
          isActive: true,
        },
      ],
    };
    await expect(assertCanAccessOrder(attacker, order.id)).rejects.toBeInstanceOf(AppError);
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.organization.delete({ where: { id: foreignOrg.id } });
  });

  it("order snapshot preserves purchase-time totals when event price changes", async () => {
    const { createOrderSnapshot } = await import("@ticketly/ticketing");
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-SNAP-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "snap@example.com",
        customerFirstName: "Snap",
        customerLastName: "Shot",
        subtotal: 29900,
        serviceFee: 2000,
        tax: 5000,
        discount: 0,
        total: 31900,
        currency: "NOK",
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: vipTypeId,
            quantity: 1,
            unitPrice: 29900,
            serviceFee: 2000,
            total: 31900,
            name: "VIP Snapshot",
          },
        },
      },
    });
    await createOrderSnapshot(order.id);
    await prisma.ticketType.update({ where: { id: vipTypeId }, data: { price: 99900 } });
    await prisma.event.update({
      where: { id: eventId },
      data: { name: "Friday Night RENAMED" },
    });
    const snap = await prisma.orderSnapshot.findUnique({ where: { orderId: order.id } });
    expect(snap).toBeTruthy();
    expect(snap!.eventName).toBe("Friday Night");
    const payload = snap!.payload as { order?: { total?: number }; event?: { name?: string } };
    expect(payload.order?.total).toBe(31900);
    expect(payload.event?.name).toBe("Friday Night");
    // After rename/price change, snapshot stays frozen
    expect(snap!.eventName).not.toBe("Friday Night RENAMED");
    // restore event name for other tests
    await prisma.event.update({ where: { id: eventId }, data: { name: "Friday Night" } });
    await prisma.ticketType.update({ where: { id: vipTypeId }, data: { price: 49900 } });
  });
});
