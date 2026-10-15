import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PaymentProviderType,
  PaymentStatus,
  ReservationStatus,
  TicketStatus,
  WebhookProcessStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { PaymentService } from "@/services/payment-service";
import { RefundService } from "@/services/refund-service";
import { ReservationService } from "@/services/reservation-service";

describe("Nexi payment integration", () => {
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
      console.warn("[nexi-payments] Skipping — DATABASE_URL not reachable");
      return;
    }

    process.env.NEXI_WEBHOOK_SECRET = "webhooksecret123456";
    process.env.NEXI_SECRET_API_KEY = "nexi_unit_secret_abcdefghijklmnop";
    process.env.NEXI_CHECKOUT_KEY = "nexi_unit_checkout_abcdefghijklmnop";
    process.env.NEXI_ENVIRONMENT = "test";
    process.env.APP_URL = "http://localhost:3456";
    process.env.PAYMENT_PROVIDER = "nexi";
    process.env.STRIPE_MOCK_MODE = "false";

    const org = await prisma.organization.findFirst({ where: { slug: "titan-events" } });
    if (!org) {
      // Seed minimal fixtures when DB empty
      const created = await prisma.organization.create({
        data: {
          name: "Titan Events",
          slug: `titan-events-${Date.now()}`,
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
        name: "Nexi Test Event",
        slug: `nexi-test-${Date.now()}`,
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

  beforeEach(() => {
    process.env.NEXI_WEBHOOK_SECRET = "webhooksecret123456";
  });

  async function createPendingOrder(total = 24900) {
    return prisma.order.create({
      data: {
        orderNumber: `TKT-NEXI-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
        organizationId,
        eventId,
        customerEmail: "nexi@example.com",
        customerFirstName: "Nexi",
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
            provider: PaymentProviderType.NEXI,
            providerPaymentId: `pay_${Date.now()}`,
            providerSessionId: `pay_${Date.now()}`,
            amount: total,
            currency: "NOK",
            status: PaymentStatus.PENDING,
            idempotencyKey: `idem_${Date.now()}_${Math.random()}`,
          },
        },
      },
      include: { payments: true },
    });
  }

  function webhookBody(opts: {
    id: string;
    event: string;
    paymentId: string;
    orderId?: string;
    amount?: number;
    currency?: string;
    chargeId?: string;
    paymentMethod?: string;
  }) {
    return JSON.stringify({
      id: opts.id,
      event: opts.event,
      data: {
        paymentId: opts.paymentId,
        myReference: opts.orderId,
        chargeId: opts.chargeId,
        paymentMethod: opts.paymentMethod,
        order: {
          amount: {
            amount: String(opts.amount ?? 24900),
            currency: opts.currency ?? "NOK",
          },
        },
      },
    });
  }

  function skipIfNoDb() {
    if (!dbReady) return true;
    return false;
  }

  it("handles checkout completed webhook and issues tickets once", async () => {
    if (skipIfNoDb()) return;
    const order = await createPendingOrder(24900);
    const paymentId = order.payments[0]!.providerPaymentId!;

    const first = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.NEXI,
      rawBody: webhookBody({
        id: `evt_paid_${order.id}`,
        event: "payment.checkout.completed",
        paymentId,
        orderId: order.id,
        amount: 24900,
        chargeId: "chg_1",
        paymentMethod: "Visa",
      }),
      signature: "webhooksecret123456",
    });
    expect(first.duplicate).toBe(false);

    const second = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.NEXI,
      rawBody: webhookBody({
        id: `evt_paid_${order.id}`,
        event: "payment.checkout.completed",
        paymentId,
        orderId: order.id,
        amount: 24900,
      }),
      signature: "webhooksecret123456",
    });
    expect(second.duplicate).toBe(true);

    const paid = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: true, payments: true },
    });
    expect(paid.paymentStatus).toBe(PaymentStatus.PAID);
    expect(paid.tickets.length).toBe(1);
    expect(paid.payments[0]?.paymentMethod).toBe("VISA");

    // Issue again is idempotent
    await PaymentService.markOrderPaid({
      orderId: order.id,
      provider: PaymentProviderType.NEXI,
      providerPaymentId: paymentId,
      amount: 24900,
      currency: "NOK",
    });
    const again = await prisma.ticket.count({ where: { orderId: order.id } });
    expect(again).toBe(1);
  });

  it("rejects wrong amount", async () => {
    if (skipIfNoDb()) return;
    const order = await createPendingOrder(24900);
    const paymentId = order.payments[0]!.providerPaymentId!;

    await expect(
      PaymentService.handleProviderWebhook({
        provider: PaymentProviderType.NEXI,
        rawBody: webhookBody({
          id: `evt_amt_${order.id}`,
          event: "payment.checkout.completed",
          paymentId,
          orderId: order.id,
          amount: 100,
        }),
        signature: "webhooksecret123456",
      })
    ).rejects.toThrow(/beløp|AMOUNT|AMOUNT/i);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentAnomaly).toBe(true);
    expect(fresh.paymentStatus).toBe(PaymentStatus.REVIEW_REQUIRED);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects wrong currency", async () => {
    if (skipIfNoDb()) return;
    const order = await createPendingOrder(24900);
    const paymentId = order.payments[0]!.providerPaymentId!;

    await expect(
      PaymentService.handleProviderWebhook({
        provider: PaymentProviderType.NEXI,
        rawBody: webhookBody({
          id: `evt_cur_${order.id}`,
          event: "payment.checkout.completed",
          paymentId,
          orderId: order.id,
          amount: 24900,
          currency: "SEK",
        }),
        signature: "webhooksecret123456",
      })
    ).rejects.toThrow(/valuta|currency|CURRENCY/i);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentAnomaly).toBe(true);
  });

  it("ignores unknown payment id without crashing (no order)", async () => {
    if (skipIfNoDb()) return;
    const eventId = `evt_unknown_${Date.now()}`;
    const result = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.NEXI,
      rawBody: webhookBody({
        id: eventId,
        event: "payment.checkout.completed",
        paymentId: "pay_does_not_exist",
        amount: 24900,
      }),
      signature: "webhooksecret123456",
    });
    expect(result.duplicate).toBe(false);
    const wh = await prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: { provider: PaymentProviderType.NEXI, eventId },
      },
    });
    expect(wh?.status).toBe(WebhookProcessStatus.PROCESSED);
  });

  it("records Vipps metadata through Nexi", async () => {
    if (skipIfNoDb()) return;
    const order = await createPendingOrder(24900);
    const paymentId = order.payments[0]!.providerPaymentId!;
    await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.NEXI,
      rawBody: webhookBody({
        id: `evt_vipps_${order.id}`,
        event: "payment.charge.created.v2",
        paymentId,
        orderId: order.id,
        amount: 24900,
        chargeId: "chg_vipps",
        paymentMethod: "Vipps",
      }),
      signature: "webhooksecret123456",
    });
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.paymentMethod).toBe("VIPPS");
    expect(payment.paymentType).toBe("WALLET");
    expect(payment.providerChargeId).toBe("chg_vipps");
  });

  it("reservation expiration does not free inventory after paid webhook", async () => {
    if (skipIfNoDb()) return;
    const order = await createPendingOrder(24900);
    const paymentId = order.payments[0]!.providerPaymentId!;

    await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { quantityReserved: { increment: 1 } },
    });

    await prisma.ticketReservation.create({
      data: {
        eventId,
        ticketTypeId,
        sessionId: `sess_${order.id}`,
        quantity: 1,
        unitPriceSnapshot: 24900,
        status: ReservationStatus.ACTIVE,
        expiresAt: new Date(Date.now() - 60_000),
        orderId: order.id,
      },
    });

    await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.NEXI,
      rawBody: webhookBody({
        id: `evt_race_${order.id}`,
        event: "payment.checkout.completed",
        paymentId,
        orderId: order.id,
        amount: 24900,
      }),
      signature: "webhooksecret123456",
    });

    const before = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    await ReservationService.releaseExpired();
    const after = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    // Paid order reservations must not be expired/freed by cleanup
    const res = await prisma.ticketReservation.findFirst({ where: { orderId: order.id } });
    expect(res?.status).not.toBe(ReservationStatus.EXPIRED);
    expect(after.quantityReserved).toBeLessThanOrEqual(before.quantityReserved + 1);
  });

  it("full refund and double refund protection", async () => {
    if (skipIfNoDb()) return;
    const order = await createPendingOrder(24900);
    const paymentId = order.payments[0]!.providerPaymentId!;
    await prisma.payment.updateMany({
      where: { orderId: order.id },
      data: { providerChargeId: "chg_refund_test", status: PaymentStatus.PAID },
    });
    await PaymentService.markOrderPaid({
      orderId: order.id,
      provider: PaymentProviderType.NEXI,
      providerPaymentId: paymentId,
      providerChargeId: "chg_refund_test",
      amount: 24900,
      currency: "NOK",
    });

    // Mock refund at provider boundary by using MOCK provider on payment — swap for test
    await prisma.payment.updateMany({
      where: { orderId: order.id },
      data: { provider: PaymentProviderType.MOCK, providerChargeId: "chg_x" },
    });
    process.env.PAYMENT_PROVIDER = "mock";

    const refund = await RefundService.refundOrder({ orderId: order.id, reason: "test" });
    expect(refund.status).toBe("SUCCEEDED");

    await expect(RefundService.refundOrder({ orderId: order.id })).rejects.toThrow(
      /allerede|refunder/i
    );

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets.every((t) => t.status === TicketStatus.REFUNDED)).toBe(true);

    process.env.PAYMENT_PROVIDER = "nexi";
  });

  it("stores webhook process status for audit", async () => {
    if (skipIfNoDb()) return;
    const order = await createPendingOrder(0);
    // free path not needed — just a skipped-style event
    await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.NEXI,
      rawBody: JSON.stringify({
        id: `evt_created_${order.id}`,
        event: "payment.created",
        data: { paymentId: order.payments[0]!.providerPaymentId },
      }),
      signature: "webhooksecret123456",
    });
    const row = await prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: PaymentProviderType.NEXI,
          eventId: `evt_created_${order.id}`,
        },
      },
    });
    // payment.created is acknowledged (PROCESSED) without side effects
    expect(row?.status).toBe(WebhookProcessStatus.PROCESSED);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
  });
});
