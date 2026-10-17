import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PaymentProviderType,
  PaymentStatus,
  ReservationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { PaymentService } from "@/services/payment-service";
import { TicketService } from "@/services/ticket-service";

vi.mock("@/lib/email/templates", () => ({
  sendOrderConfirmationEmail: vi.fn(async () => ({ ok: true })),
  sendTicketDeliveryEmail: vi.fn(async () => ({ ok: true })),
}));

import {
  sendOrderConfirmationEmail,
  sendTicketDeliveryEmail,
} from "@/lib/email/templates";

describe("ticket fulfillment exactly-once (PostgreSQL concurrency)", () => {
  let organizationId: string;
  let eventId: string;
  let ticketTypeId: string;
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      dbReady = false;
      console.warn("[ticket-fulfillment-race] Skipping — DATABASE_URL not reachable");
      return;
    }

    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.STRIPE_MOCK_MODE = "true";
    process.env.APP_URL = "http://localhost:3456";
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";
    process.env.TICKET_TOKEN_SECRET =
      process.env.TICKET_TOKEN_SECRET ?? "test-ticket-token-secret-32chars!!";

    const org = await prisma.organization.findFirst({ where: { slug: "titan-events" } });
    if (!org) {
      const created = await prisma.organization.create({
        data: {
          name: "Titan Events",
          slug: `titan-events-fulfill-${Date.now()}`,
          legalName: "Titan Systems AS",
          organizationNumber: "123456789",
        },
      });
      organizationId = created.id;
    } else {
      organizationId = org.id;
    }

    const startsAt = new Date(Date.now() + 7 * 864e5);
    const event = await prisma.event.create({
      data: {
        organizationId,
        sellerOrganizationId: organizationId,
        name: "Fulfillment Race Event",
        slug: `fulfill-race-${Date.now()}`,
        status: "PUBLISHED",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
        capacity: 100,
        timezone: "Europe/Oslo",
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
        quantitySold: 0,
        quantityReserved: 0,
        isPubliclyPurchasable: true,
        maxPerOrder: 6,
        admissionCount: 1,
        isBundle: false,
      },
    });
    ticketTypeId = tt.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createPendingOrder(opts: {
    quantity: number;
    withReservation?: boolean;
  }) {
    const sessionId = `fulfill_sess_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-FULFILL-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
        organizationId,
        eventId,
        customerEmail: "fulfill-race@example.com",
        customerFirstName: "Race",
        customerLastName: "Buyer",
        subtotal: 24900 * opts.quantity,
        total: 24900 * opts.quantity,
        currency: "NOK",
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: "PENDING",
        reservationSessionId: opts.withReservation ? sessionId : undefined,
        items: {
          create: {
            ticketTypeId,
            quantity: opts.quantity,
            unitPrice: 24900,
            total: 24900 * opts.quantity,
            name: "Ordinær",
          },
        },
        payments: {
          create: {
            provider: PaymentProviderType.STRIPE,
            providerSessionId: `cs_${sessionId}`,
            providerPaymentId: `pi_${sessionId}`,
            amount: 24900 * opts.quantity,
            currency: "NOK",
            status: PaymentStatus.PENDING,
          },
        },
      },
    });

    if (opts.withReservation) {
      await prisma.ticketType.update({
        where: { id: ticketTypeId },
        data: { quantityReserved: { increment: opts.quantity } },
      });
      await prisma.ticketReservation.create({
        data: {
          eventId,
          ticketTypeId,
          sessionId,
          quantity: opts.quantity,
          status: ReservationStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 15 * 60_000),
          orderId: order.id,
        },
      });
    }

    return order;
  }

  it("two concurrent markOrderPaid for qty=1 → exactly 1 ticket, sold+1, reservation once, one email pair", async () => {
    if (!dbReady) return;

    vi.mocked(sendOrderConfirmationEmail).mockClear();
    vi.mocked(sendTicketDeliveryEmail).mockClear();

    const beforeSold = (
      await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } })
    ).quantitySold;

    const order = await createPendingOrder({ quantity: 1, withReservation: true });

    const [a, b] = await Promise.all([
      PaymentService.markOrderPaid({
        orderId: order.id,
        provider: PaymentProviderType.STRIPE,
        providerSessionId: `cs_a_${order.id}`,
        providerPaymentId: `pi_a_${order.id}`,
        amount: order.total,
        currency: "NOK",
        externalEventId: `evt_session_${order.id}`,
      }),
      PaymentService.markOrderPaid({
        orderId: order.id,
        provider: PaymentProviderType.STRIPE,
        providerSessionId: `cs_b_${order.id}`,
        providerPaymentId: `pi_b_${order.id}`,
        amount: order.total,
        currency: "NOK",
        externalEventId: `evt_pi_${order.id}`,
      }),
    ]);

    expect(a.paymentStatus).toBe(PaymentStatus.PAID);
    expect(b.paymentStatus).toBe(PaymentStatus.PAID);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets.length).toBe(1);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentStatus).toBe(PaymentStatus.PAID);
    expect(fresh.ticketsFulfilledAt).not.toBeNull();
    expect(fresh.orderStatus).toBe("CONFIRMED");

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantitySold).toBe(beforeSold + 1);

    const reservations = await prisma.ticketReservation.findMany({
      where: { orderId: order.id },
    });
    expect(reservations.length).toBe(1);
    expect(reservations[0]!.status).toBe(ReservationStatus.CONVERTED);

    expect(vi.mocked(sendOrderConfirmationEmail).mock.calls.length).toBe(1);
    expect(vi.mocked(sendTicketDeliveryEmail).mock.calls.length).toBe(1);
  });

  it("two concurrent issueTicketsForPaidOrder on already-PAID qty=1 → one issuer", async () => {
    if (!dbReady) return;

    vi.mocked(sendOrderConfirmationEmail).mockClear();
    vi.mocked(sendTicketDeliveryEmail).mockClear();

    const beforeSold = (
      await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } })
    ).quantitySold;

    const order = await createPendingOrder({ quantity: 1, withReservation: true });
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PAID, paidAt: new Date() },
    });

    const results = await Promise.all([
      TicketService.fulfillPaidOrderLocked(order.id),
      TicketService.fulfillPaidOrderLocked(order.id),
    ]);

    const issuedFlags = results.map((r) => r.newlyIssued).sort();
    expect(issuedFlags).toEqual([false, true]);
    expect(results[0]!.tickets.length).toBe(1);
    expect(results[1]!.tickets.length).toBe(1);

    // Public API sends email only for newlyIssued path
    await TicketService.issueTicketsForPaidOrder(order.id);
    // Third call must not email again
    expect(vi.mocked(sendOrderConfirmationEmail).mock.calls.length).toBe(0);

    // Re-run through public API on a fresh paid order for email assert
    const order2 = await createPendingOrder({ quantity: 1 });
    await prisma.order.update({
      where: { id: order2.id },
      data: { paymentStatus: PaymentStatus.PAID, paidAt: new Date() },
    });
    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: { increment: 1 } },
    });

    vi.mocked(sendOrderConfirmationEmail).mockClear();
    vi.mocked(sendTicketDeliveryEmail).mockClear();

    await Promise.all([
      TicketService.issueTicketsForPaidOrder(order2.id),
      TicketService.issueTicketsForPaidOrder(order2.id),
    ]);

    const tickets2 = await prisma.ticket.findMany({ where: { orderId: order2.id } });
    expect(tickets2.length).toBe(1);
    expect(vi.mocked(sendOrderConfirmationEmail).mock.calls.length).toBe(1);
    expect(vi.mocked(sendTicketDeliveryEmail).mock.calls.length).toBe(1);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantitySold).toBe(beforeSold + 2);
  });

  it("qty=2 → exactly 2 tickets under concurrent markOrderPaid", async () => {
    if (!dbReady) return;

    const beforeSold = (
      await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } })
    ).quantitySold;

    const order = await createPendingOrder({ quantity: 2, withReservation: true });

    await Promise.all([
      PaymentService.markOrderPaid({
        orderId: order.id,
        provider: PaymentProviderType.STRIPE,
        providerPaymentId: `pi_q2a_${order.id}`,
        amount: order.total,
        currency: "NOK",
        externalEventId: `evt_q2_session_${order.id}`,
      }),
      PaymentService.markOrderPaid({
        orderId: order.id,
        provider: PaymentProviderType.STRIPE,
        providerPaymentId: `pi_q2b_${order.id}`,
        amount: order.total,
        currency: "NOK",
        externalEventId: `evt_q2_pi_${order.id}`,
      }),
    ]);

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets.length).toBe(2);
    expect(new Set(tickets.map((t) => t.publicId)).size).toBe(2);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantitySold).toBe(beforeSold + 2);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.ticketsFulfilledAt).not.toBeNull();
  });
});
