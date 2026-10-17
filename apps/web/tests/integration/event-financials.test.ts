import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PaymentProviderType,
  PaymentStatus,
  RefundStatus,
  TicketStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEventFinancialTotals } from "@/lib/admin/event-financials";
import { PaymentService } from "@/services/payment-service";
import { RefundService } from "@/services/refund-service";

describe("event financials integration", () => {
  let organizationId: string;
  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      dbReady = false;
      console.warn("[event-financials] Skipping — DATABASE_URL not reachable");
      return;
    }

    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.STRIPE_MOCK_MODE = "true";
    process.env.APP_URL = "http://localhost:3456";
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";

    const org = await prisma.organization.findFirst({ where: { slug: "titan-events" } });
    if (org) {
      organizationId = org.id;
    } else {
      const created = await prisma.organization.create({
        data: {
          name: "Titan Events",
          slug: `titan-fin-${Date.now()}`,
          legalName: "Titan Systems AS",
          organizationNumber: "123456789",
        },
      });
      organizationId = created.id;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createIsolatedEvent(slugPrefix: string) {
    const startsAt = new Date(Date.now() + 7 * 864e5);
    const event = await prisma.event.create({
      data: {
        organizationId,
        sellerOrganizationId: organizationId,
        name: `Financials ${slugPrefix}`,
        slug: `${slugPrefix}-${Date.now()}`,
        status: "PUBLISHED",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
        capacity: 50,
        timezone: "Europe/Oslo",
        city: "Oslo",
      },
    });
    const tt = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: "Ordinær",
        price: 17000,
        quantityTotal: 20,
        quantityReleased: 20,
        quantitySold: 0,
        quantityReserved: 0,
        isPubliclyPurchasable: true,
        maxPerOrder: 6,
      },
    });
    return { eventId: event.id, ticketTypeId: tt.id };
  }

  function stripeWebhookBody(opts: {
    id: string;
    orderId: string;
    sessionId: string;
    paymentId: string;
    amount: number;
    type?: string;
  }) {
    return JSON.stringify({
      id: opts.id,
      type: opts.type ?? "checkout.session.completed",
      orderId: opts.orderId,
      sessionId: opts.sessionId,
      paymentId: opts.paymentId,
      amount: opts.amount,
      currency: "NOK",
      paymentMethod: "CARD",
    });
  }

  async function createPaidOrder(opts: {
    eventId: string;
    ticketTypeId: string;
    total: number;
    qty: number;
    suffix: string;
  }) {
    const sessionId = `mock_cs_fin_${opts.suffix}_${Date.now()}`;
    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-FIN-${opts.suffix}-${Date.now()}`,
        organizationId,
        eventId: opts.eventId,
        customerEmail: "fin@example.com",
        customerFirstName: "Fin",
        customerLastName: "Test",
        subtotal: opts.total,
        total: opts.total,
        currency: "NOK",
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: "PENDING",
        items: {
          create: {
            ticketTypeId: opts.ticketTypeId,
            quantity: opts.qty,
            unitPrice: Math.round(opts.total / opts.qty),
            total: opts.total,
            name: "Ordinær",
          },
        },
        payments: {
          create: {
            provider: PaymentProviderType.STRIPE,
            amount: opts.total,
            currency: "NOK",
            status: PaymentStatus.PENDING,
            providerPaymentId: `pi_fin_${opts.suffix}_${Date.now()}`,
            providerSessionId: sessionId,
            idempotencyKey: `fin_${opts.suffix}_${Date.now()}_${Math.random()}`,
          },
        },
      },
      include: { payments: true },
    });

    const payment = order.payments[0]!;
    await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: stripeWebhookBody({
        id: `evt_fin_${opts.suffix}_${order.id}`,
        orderId: order.id,
        sessionId: payment.providerSessionId!,
        paymentId: payment.providerPaymentId!,
        amount: opts.total,
      }),
      signature: "mock",
    });

    return prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: true, payments: true, refunds: true },
    });
  }

  it("paid 170 NOK, no refund", async () => {
    if (!dbReady) return;
    const { eventId, ticketTypeId } = await createIsolatedEvent("fin-none");
    const order = await createPaidOrder({
      eventId,
      ticketTypeId,
      total: 17000,
      qty: 1,
      suffix: "none",
    });
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);
    expect(order.tickets.every((t) => t.status === TicketStatus.VALID)).toBe(true);

    const totals = await getEventFinancialTotals(prisma, eventId);
    expect(totals.grossSales).toBe(17000);
    expect(totals.successfulRefundAmount).toBe(0);
    expect(totals.netRevenue).toBe(17000);
    expect(totals.activeSoldTicketCount).toBe(1);
    expect(totals.refundedTicketCount).toBe(0);
  });

  it("full refund 170 NOK — gross remains, net zero", async () => {
    if (!dbReady) return;
    const { eventId, ticketTypeId } = await createIsolatedEvent("fin-full");
    const order = await createPaidOrder({
      eventId,
      ticketTypeId,
      total: 17000,
      qty: 1,
      suffix: "full",
    });

    await RefundService.refundOrder({
      orderId: order.id,
      ticketIds: [order.tickets[0]!.id],
      reason: "full refund test",
    });

    const totals = await getEventFinancialTotals(prisma, eventId);
    expect(totals.grossSales).toBe(17000);
    expect(totals.successfulRefundAmount).toBe(17000);
    expect(totals.netRevenue).toBe(0);
    expect(totals.refundedTicketCount).toBe(1);
    expect(totals.activeSoldTicketCount).toBe(0);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantitySold).toBe(0);
  });

  it("partial refund and multi-ticket one refunded", async () => {
    if (!dbReady) return;
    const { eventId, ticketTypeId } = await createIsolatedEvent("fin-part");
    const order = await createPaidOrder({
      eventId,
      ticketTypeId,
      total: 34000,
      qty: 2,
      suffix: "part",
    });
    expect(order.tickets.length).toBe(2);

    await RefundService.refundOrder({
      orderId: order.id,
      ticketIds: [order.tickets[0]!.id],
      reason: "one ticket",
    });

    const totals = await getEventFinancialTotals(prisma, eventId);
    expect(totals.grossSales).toBe(34000);
    expect(totals.successfulRefundAmount).toBe(17000);
    expect(totals.netRevenue).toBe(17000);
    expect(totals.refundedTicketCount).toBe(1);
    expect(totals.activeSoldTicketCount).toBe(1);

    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt.quantitySold).toBe(1);
  });

  it("duplicate refund webhook does not double refund amount", async () => {
    if (!dbReady) return;
    const { eventId, ticketTypeId } = await createIsolatedEvent("fin-wh");
    const order = await createPaidOrder({
      eventId,
      ticketTypeId,
      total: 17000,
      qty: 1,
      suffix: "wh",
    });

    await RefundService.refundOrder({
      orderId: order.id,
      ticketIds: [order.tickets[0]!.id],
      reason: "webhook dup",
    });

    const payment = order.payments[0]!;
    const body = stripeWebhookBody({
      id: `evt_charge_refunded_${order.id}`,
      orderId: order.id,
      sessionId: payment.providerSessionId!,
      paymentId: payment.providerPaymentId!,
      amount: 17000,
      type: "charge.refunded",
    });

    await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: body,
      signature: "mock",
    });
    const second = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: body,
      signature: "mock",
    });
    expect(second.duplicate).toBe(true);

    const refundCount = await prisma.refund.count({
      where: { orderId: order.id, status: RefundStatus.SUCCEEDED },
    });
    expect(refundCount).toBe(1);

    const totals = await getEventFinancialTotals(prisma, eventId);
    expect(totals.successfulRefundAmount).toBe(17000);
    expect(totals.netRevenue).toBe(0);

    const existing = await prisma.refund.findFirstOrThrow({
      where: { orderId: order.id, status: RefundStatus.SUCCEEDED },
    });
    expect(existing.providerRefundId).toBeTruthy();

    await expect(
      prisma.refund.create({
        data: {
          orderId: order.id,
          amount: 17000,
          currency: "NOK",
          status: RefundStatus.SUCCEEDED,
          providerRefundId: existing.providerRefundId!,
          ticketIds: [],
        },
      })
    ).rejects.toThrow();

    const afterDupAttempt = await getEventFinancialTotals(prisma, eventId);
    expect(afterDupAttempt.successfulRefundAmount).toBe(17000);
  });
});
