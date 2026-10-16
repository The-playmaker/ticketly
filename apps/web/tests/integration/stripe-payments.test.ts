import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PaymentProviderType,
  PaymentStatus,
  TicketStatus,
  WebhookProcessStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { PaymentService } from "@/services/payment-service";
import { RefundService } from "@/services/refund-service";

describe("Stripe payment integration (mock provider)", () => {
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
      console.warn("[stripe-payments] Skipping — DATABASE_URL not reachable");
      return;
    }

    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.STRIPE_MOCK_MODE = "true";
    process.env.APP_URL = "http://localhost:3456";
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";

    const org = await prisma.organization.findFirst({ where: { slug: "titan-events" } });
    if (!org) {
      const created = await prisma.organization.create({
        data: {
          name: "Titan Events",
          slug: `titan-events-stripe-${Date.now()}`,
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
        name: "Stripe Test Event",
        slug: `stripe-test-${Date.now()}`,
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
      },
    });
    ticketTypeId = tt.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createPendingStripeOrder(total = 24900) {
    const sessionId = `mock_cs_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    return prisma.order.create({
      data: {
        orderNumber: `TKT-STRIPE-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
        organizationId,
        eventId,
        customerEmail: "stripe@example.com",
        customerFirstName: "Stripe",
        customerLastName: "Test",
        subtotal: total,
        total,
        currency: "NOK",
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: "PENDING",
        items: {
          create: {
            ticketTypeId,
            quantity: 1,
            unitPrice: total,
            total,
            name: "Ordinær",
          },
        },
        payments: {
          create: {
            provider: PaymentProviderType.STRIPE,
            providerPaymentId: `pi_${Date.now()}`,
            providerSessionId: sessionId,
            amount: total,
            currency: "NOK",
            status: PaymentStatus.PENDING,
            idempotencyKey: `checkout_${Date.now()}_${Math.random()}`,
          },
        },
      },
      include: { payments: true },
    });
  }

  function stripeWebhookBody(opts: {
    id: string;
    orderId: string;
    sessionId: string;
    paymentId: string;
    amount?: number;
    currency?: string;
    paymentMethod?: string;
  }) {
    return JSON.stringify({
      id: opts.id,
      type: "checkout.session.completed",
      orderId: opts.orderId,
      sessionId: opts.sessionId,
      paymentId: opts.paymentId,
      amount: opts.amount ?? 24900,
      currency: opts.currency ?? "NOK",
      paymentMethod: opts.paymentMethod ?? "CARD",
    });
  }

  it("creates checkout + webhook fulfillment once; duplicate is harmless", async () => {
    if (!dbReady) return;
    const order = await createPendingStripeOrder(24900);
    const payment = order.payments[0]!;

    const first = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: stripeWebhookBody({
        id: `evt_stripe_${order.id}`,
        orderId: order.id,
        sessionId: payment.providerSessionId!,
        paymentId: payment.providerPaymentId!,
        amount: 24900,
      }),
      signature: "mock",
    });
    expect(first.duplicate).toBe(false);

    const second = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: stripeWebhookBody({
        id: `evt_stripe_${order.id}`,
        orderId: order.id,
        sessionId: payment.providerSessionId!,
        paymentId: payment.providerPaymentId!,
        amount: 24900,
      }),
      signature: "mock",
    });
    expect(second.duplicate).toBe(true);

    const paid = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: true, payments: true },
    });
    expect(paid.paymentStatus).toBe(PaymentStatus.PAID);
    expect(paid.tickets.length).toBe(1);
    expect(paid.payments[0]?.provider).toBe(PaymentProviderType.STRIPE);

    const wh = await prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: PaymentProviderType.STRIPE,
          eventId: `evt_stripe_${order.id}`,
        },
      },
    });
    expect(wh?.status).toBe(WebhookProcessStatus.PROCESSED);
  });

  it("rejects wrong amount", async () => {
    if (!dbReady) return;
    const order = await createPendingStripeOrder(24900);
    const payment = order.payments[0]!;

    await expect(
      PaymentService.handleProviderWebhook({
        provider: PaymentProviderType.STRIPE,
        rawBody: stripeWebhookBody({
          id: `evt_stripe_amt_${order.id}`,
          orderId: order.id,
          sessionId: payment.providerSessionId!,
          paymentId: payment.providerPaymentId!,
          amount: 100,
        }),
        signature: "mock",
      })
    ).rejects.toThrow(/beløp|amount|AMOUNT/i);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentAnomaly).toBe(true);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects wrong currency", async () => {
    if (!dbReady) return;
    const order = await createPendingStripeOrder(24900);
    const payment = order.payments[0]!;

    await expect(
      PaymentService.handleProviderWebhook({
        provider: PaymentProviderType.STRIPE,
        rawBody: stripeWebhookBody({
          id: `evt_stripe_cur_${order.id}`,
          orderId: order.id,
          sessionId: payment.providerSessionId!,
          paymentId: payment.providerPaymentId!,
          amount: 24900,
          currency: "SEK",
        }),
        signature: "mock",
      })
    ).rejects.toThrow(/valuta|currency|CURRENCY/i);
  });

  it("refunds and partial refunds via stored Stripe provider", async () => {
    if (!dbReady) return;
    const order = await createPendingStripeOrder(49800);
    // Two tickets for partial refund
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        ticketTypeId,
        quantity: 2,
        unitPrice: 24900,
        total: 49800,
        name: "Ordinær",
      },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { subtotal: 49800, total: 49800 },
    });
    await prisma.payment.update({
      where: { id: order.payments[0]!.id },
      data: { amount: 49800 },
    });

    const payment = order.payments[0]!;
    await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: stripeWebhookBody({
        id: `evt_stripe_ref_${order.id}`,
        orderId: order.id,
        sessionId: payment.providerSessionId!,
        paymentId: payment.providerPaymentId!,
        amount: 49800,
      }),
      signature: "mock",
    });

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets.length).toBe(2);

    // Switch default provider to Nexi — historical Stripe order must still refund via Stripe
    process.env.PAYMENT_PROVIDER = "nexi";
    process.env.STRIPE_MOCK_MODE = "true";

    const partial = await RefundService.refundOrder({
      orderId: order.id,
      ticketIds: [tickets[0]!.id],
      reason: "partial test",
    });
    expect(partial.status).toBe("SUCCEEDED");

    const afterPartial = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } });
    expect(afterPartial.status).toBe(TicketStatus.REFUNDED);

    const remaining = await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[1]!.id } });
    expect(remaining.status).toBe(TicketStatus.VALID);

    const full = await RefundService.refundOrder({
      orderId: order.id,
      ticketIds: [tickets[1]!.id],
      reason: "rest",
    });
    expect(full.status).toBe("SUCCEEDED");

    // Restore for other tests
    process.env.PAYMENT_PROVIDER = "stripe";
  });
});
