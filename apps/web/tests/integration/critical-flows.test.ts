import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, PaymentStatus, TicketStatus } from "@prisma/client";
import { ReservationService } from "@/services/reservation-service";
import { CheckInService } from "@/services/check-in-service";
import { PaymentService } from "@/services/payment-service";
import { PaymentProviderType } from "@prisma/client";
import {
  generateSecureToken,
  generatePublicTicketId,
  hashTicketToken,
  encryptTicketToken,
} from "@/lib/tickets/token";

const prisma = new PrismaClient();

describe("integration: reservation race & check-in", () => {
  let eventId: string;
  let ticketTypeId: string;
  let organizationId: string;

  beforeAll(async () => {
    process.env.STRIPE_MOCK_MODE = "true";
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";

    const event = await prisma.event.findFirst({
      where: { slug: "friday-night" },
      include: { ticketTypes: true },
    });
    if (!event) throw new Error("Seed data missing — run npm run db:seed");
    eventId = event.id;
    organizationId = event.organizationId;
    const tt = await prisma.ticketType.create({
      data: {
        eventId,
        name: `RaceTest-${Date.now()}`,
        price: 10000,
        quantityTotal: 1,
        quantityReleased: 1,
        quantitySold: 0,
        quantityReserved: 0,
        maxPerOrder: 1,
        minPerOrder: 1,
        sortOrder: 99,
        isVisible: false,
        isPubliclyPurchasable: true,
      },
    });
    ticketTypeId = tt.id;
  });

  afterAll(async () => {
    await prisma.ticketReservation.deleteMany({ where: { ticketTypeId } });
    await prisma.checkIn.deleteMany({ where: { ticket: { ticketTypeId } } });
    await prisma.ticket.deleteMany({ where: { ticketTypeId } });
    await prisma.orderItem.deleteMany({ where: { ticketTypeId } });
    await prisma.ticketType.delete({ where: { id: ticketTypeId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("prevents two concurrent reservations of the last ticket", async () => {
    const results = await Promise.allSettled([
      ReservationService.reserve({
        eventId,
        sessionId: `race-a-${Date.now()}`,
        items: [{ ticketTypeId, quantity: 1 }],
      }),
      ReservationService.reserve({
        eventId,
        sessionId: `race-b-${Date.now()}`,
        items: [{ ticketTypeId, quantity: 1 }],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantityReserved).toBe(1);
  });

  it("rejects double check-in atomically", async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-TEST-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "test@example.com",
        customerFirstName: "Test",
        customerLastName: "User",
        subtotal: 10000,
        serviceFee: 0,
        tax: 0,
        discount: 0,
        total: 10000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId,
            quantity: 1,
            unitPrice: 10000,
            serviceFee: 0,
            tax: 0,
            total: 10000,
            name: "RaceTest",
          },
        },
      },
      include: { items: true },
    });

    const token = generateSecureToken();
    const ticket = await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(token),
        tokenCipher: encryptTicketToken(token),
        secureToken: null,
        orderId: order.id,
        orderItemId: order.items[0]!.id,
        eventId,
        ticketTypeId,
        holderName: "Test User",
        holderEmail: "test@example.com",
        status: TicketStatus.VALID,
      },
    });

    const [a, b] = await Promise.all([
      CheckInService.checkInByToken({ token, eventId }),
      CheckInService.checkInByToken({ token, eventId }),
    ]);

    const successes = [a, b].filter((r) => r.result === "SUCCESS");
    const already = [a, b].filter((r) => r.result === "ALREADY_USED");
    expect(successes.length).toBe(1);
    expect(already.length).toBe(1);

    const refreshed = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(refreshed.status).toBe(TicketStatus.CHECKED_IN);
  });

  it("rejects check-in for refunded tickets", async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-REF-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "refund@example.com",
        customerFirstName: "Ref",
        customerLastName: "Und",
        subtotal: 10000,
        total: 10000,
        paymentStatus: PaymentStatus.REFUNDED,
        orderStatus: "REFUNDED",
        items: {
          create: {
            ticketTypeId,
            quantity: 1,
            unitPrice: 10000,
            total: 10000,
            name: "RaceTest",
          },
        },
      },
      include: { items: true },
    });
    const token = generateSecureToken();
    await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(token),
        tokenCipher: encryptTicketToken(token),
        orderId: order.id,
        orderItemId: order.items[0]!.id,
        eventId,
        ticketTypeId,
        status: TicketStatus.REFUNDED,
        holderName: "Ref Und",
        holderEmail: "refund@example.com",
      },
    });

    const result = await CheckInService.checkInByToken({ token, eventId });
    expect(result.result).toBe("REFUNDED");
  });

  it("handles duplicate webhook idempotently", async () => {
    process.env.STRIPE_MOCK_MODE = "true";
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-WH-${Date.now()}`,
        organizationId,
        eventId,
        customerEmail: "wh@example.com",
        customerFirstName: "Web",
        customerLastName: "Hook",
        subtotal: 0,
        total: 0,
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: "PENDING",
        items: {
          create: {
            ticketTypeId,
            quantity: 1,
            unitPrice: 0,
            total: 0,
            name: "Guest",
          },
        },
      },
    });

    const payload = JSON.stringify({
      id: `evt_idem_${order.id}`,
      type: "checkout.session.completed",
      orderId: order.id,
      sessionId: `cs_${order.id}`,
      paymentId: `pi_${order.id}`,
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

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.paymentStatus).toBe(PaymentStatus.PAID);
  });
});
