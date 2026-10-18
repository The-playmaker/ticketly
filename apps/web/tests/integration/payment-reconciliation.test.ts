import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PaymentProviderType,
  PaymentStatus,
  RefundStatus,
  TicketStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { PaymentService } from "@/services/payment-service";
import { PaymentReconciliationService } from "@/services/payment-reconciliation-service";
import type {
  StripeLookupClient,
  StripeOrderLookup,
  StripePaymentIntentSnapshot,
  StripeRefundSnapshot,
  StripeSessionSnapshot,
} from "@/lib/payments/stripe-lookup";

function mockClient(lookup: StripeOrderLookup): StripeLookupClient {
  return {
    async retrieveSession(id: string) {
      if (lookup.session?.id === id) return lookup.session;
      return lookup.session;
    },
    async retrievePaymentIntent(id: string) {
      if (lookup.paymentIntent?.id === id) return lookup.paymentIntent;
      return lookup.paymentIntent;
    },
    async listRefunds() {
      return lookup.refunds;
    },
  };
}

function session(partial: Partial<StripeSessionSnapshot> & { id: string }): StripeSessionSnapshot {
  return {
    status: "complete",
    paymentStatus: "paid",
    amountTotal: 24900,
    currency: "nok",
    livemode: false,
    metadata: {},
    paymentIntentId: null,
    ...partial,
  };
}

function pi(
  partial: Partial<StripePaymentIntentSnapshot> & { id: string }
): StripePaymentIntentSnapshot {
  return {
    status: "succeeded",
    amount: 24900,
    currency: "nok",
    livemode: false,
    metadata: {},
    lastPaymentErrorCode: null,
    outcomeType: null,
    riskLevel: null,
    amountRefunded: 0,
    chargeId: null,
    ...partial,
  };
}

describe("Payment reconciliation (Stripe ↔ Ticketly)", () => {
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
      console.warn("[payment-reconciliation] Skipping — DATABASE_URL not reachable");
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
          slug: `titan-events-recon-${Date.now()}`,
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
        name: "Reconcile Test Event",
        slug: `recon-test-${Date.now()}`,
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

  async function createPendingOrder(opts?: {
    total?: number;
    currency?: string;
    status?: PaymentStatus;
    sessionId?: string;
    paymentId?: string;
  }) {
    const total = opts?.total ?? 24900;
    const sessionId = opts?.sessionId ?? `cs_test_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    const paymentId = opts?.paymentId ?? `pi_test_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    return prisma.order.create({
      data: {
        orderNumber: `TKT-RECON-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
        organizationId,
        eventId,
        customerEmail: "recon@example.com",
        customerFirstName: "Recon",
        customerLastName: "Test",
        subtotal: total,
        total,
        currency: opts?.currency ?? "NOK",
        paymentStatus: opts?.status ?? PaymentStatus.PENDING,
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
            providerPaymentId: paymentId,
            providerSessionId: sessionId,
            amount: total,
            currency: opts?.currency ?? "NOK",
            status: opts?.status ?? PaymentStatus.PENDING,
            idempotencyKey: `recon_checkout_${Date.now()}_${Math.random()}`,
          },
        },
      },
      include: { payments: true },
    });
  }

  it("Stripe succeeded + Ticketly pending => PAID once via markOrderPaid", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;
    const client = mockClient({
      session: session({
        id: payment.providerSessionId!,
        paymentStatus: "paid",
        amountTotal: 24900,
        currency: "nok",
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        paymentIntentId: payment.providerPaymentId!,
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        status: "succeeded",
        amount: 24900,
        currency: "nok",
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [],
    });

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });

    expect(row.proposedAction).toBe("mark_paid");
    expect(row.applied).toBe(true);

    const paid = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: true },
    });
    expect(paid.paymentStatus).toBe(PaymentStatus.PAID);
    expect(paid.tickets.length).toBe(1);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: order.id, action: "PAYMENT_RECONCILED" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("duplicate reconcile => no duplicate tickets", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;
    const client = mockClient({
      session: session({
        id: payment.providerSessionId!,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        paymentIntentId: payment.providerPaymentId!,
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [],
    });

    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });
    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });

    const tickets = await prisma.ticket.count({ where: { orderId: order.id } });
    expect(tickets).toBe(1);
  });

  it("Stripe failed => FAILED", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;
    const client = mockClient({
      session: session({
        id: payment.providerSessionId!,
        status: "open",
        paymentStatus: "unpaid",
        paymentIntentId: payment.providerPaymentId!,
        metadata: { orderId: order.id },
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        status: "requires_payment_method",
        lastPaymentErrorCode: "card_declined",
        metadata: { orderId: order.id },
      }),
      refunds: [],
    });

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });
    expect(row.proposedAction).toBe("mark_failed");
    expect(row.applied).toBe(true);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentStatus).toBe(PaymentStatus.FAILED);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("Radar blocked/review => REVIEW_REQUIRED, no tickets", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;

    const blocked = mockClient({
      session: session({
        id: payment.providerSessionId!,
        paymentStatus: "unpaid",
        status: "open",
        paymentIntentId: payment.providerPaymentId!,
        metadata: { orderId: order.id },
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        status: "requires_payment_method",
        outcomeType: "blocked",
        lastPaymentErrorCode: "card_declined",
        metadata: { orderId: order.id },
      }),
      refunds: [],
    });

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: blocked,
    });
    expect(row.proposedAction).toBe("mark_review");
    expect(row.anomalyReason).toBe("RADAR_BLOCKED");

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentStatus).toBe(PaymentStatus.REVIEW_REQUIRED);
    expect(fresh.paymentAnomaly).toBe(true);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);

    const reviewOrder = await createPendingOrder();
    const reviewPayment = reviewOrder.payments[0]!;
    const reviewClient = mockClient({
      session: session({
        id: reviewPayment.providerSessionId!,
        paymentStatus: "unpaid",
        status: "open",
        paymentIntentId: reviewPayment.providerPaymentId!,
        metadata: { orderId: reviewOrder.id },
      }),
      paymentIntent: pi({
        id: reviewPayment.providerPaymentId!,
        status: "requires_capture",
        outcomeType: "manual_review",
        riskLevel: "elevated",
        metadata: { orderId: reviewOrder.id },
      }),
      refunds: [],
    });

    const reviewRow = await PaymentReconciliationService.reconcileOrder(reviewOrder.id, {
      apply: true,
      stripeClient: reviewClient,
    });
    expect(reviewRow.anomalyReason).toBe("RADAR_REVIEW");
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: reviewOrder.id } })).paymentStatus
    ).toBe(PaymentStatus.REVIEW_REQUIRED);
  });

  it("expired session + succeeded PI => PAID (conflict policy)", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;
    const client = mockClient({
      session: session({
        id: payment.providerSessionId!,
        status: "expired",
        paymentStatus: "unpaid",
        paymentIntentId: payment.providerPaymentId!,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        status: "succeeded",
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [],
    });

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });
    expect(row.proposedAction).toBe("mark_paid");
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus
    ).toBe(PaymentStatus.PAID);
  });

  it("expired session + no PI => cancelled", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder({ paymentId: `pi_missing_${Date.now()}` });
    const payment = order.payments[0]!;
    const client: StripeLookupClient = {
      async retrieveSession() {
        return session({
          id: payment.providerSessionId!,
          status: "expired",
          paymentStatus: "unpaid",
          paymentIntentId: null,
          metadata: { orderId: order.id },
        });
      },
      async retrievePaymentIntent() {
        return null;
      },
      async listRefunds() {
        return [];
      },
    };

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });
    expect(row.proposedAction).toBe("mark_cancelled");
    expect(row.anomalyReason).toBe("EXPIRED_SESSION_NO_PI");
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus
    ).toBe(PaymentStatus.CANCELLED);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("amount mismatch => REVIEW_REQUIRED", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder({ total: 24900 });
    const payment = order.payments[0]!;
    const client = mockClient({
      session: session({
        id: payment.providerSessionId!,
        amountTotal: 100,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        paymentIntentId: payment.providerPaymentId!,
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        amount: 100,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [],
    });

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });
    expect(row.proposedAction).toBe("mark_review");
    expect(row.anomalyReason).toBe("AMOUNT_MISMATCH");
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentStatus).toBe(PaymentStatus.REVIEW_REQUIRED);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("currency mismatch => REVIEW_REQUIRED", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;
    const client = mockClient({
      session: session({
        id: payment.providerSessionId!,
        currency: "sek",
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        paymentIntentId: payment.providerPaymentId!,
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        currency: "sek",
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [],
    });

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });
    expect(row.anomalyReason).toBe("CURRENCY_MISMATCH");
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus
    ).toBe(PaymentStatus.REVIEW_REQUIRED);
  });

  it("full refund => REFUNDED without duplicate rows on retry", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;

    // First mark paid via reconcile
    const paidClient = mockClient({
      session: session({
        id: payment.providerSessionId!,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        paymentIntentId: payment.providerPaymentId!,
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [],
    });
    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: paidClient,
    });

    const refund: StripeRefundSnapshot = {
      id: `re_full_${order.id}`,
      amount: 24900,
      currency: "nok",
      status: "succeeded",
      paymentIntentId: payment.providerPaymentId!,
    };
    const refundClient = mockClient({
      session: session({
        id: payment.providerSessionId!,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        paymentIntentId: payment.providerPaymentId!,
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        amountRefunded: 24900,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [refund],
    });

    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: refundClient,
    });
    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: refundClient,
    });

    const refunds = await prisma.refund.findMany({
      where: { orderId: order.id, status: RefundStatus.SUCCEEDED },
    });
    expect(refunds.length).toBe(1);
    expect(refunds[0]!.providerRefundId).toBe(refund.id);

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.paymentStatus).toBe(PaymentStatus.REFUNDED);
  });

  it("partial refund => PARTIALLY_REFUNDED", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder({ total: 49800 });
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
    await prisma.payment.update({
      where: { id: order.payments[0]!.id },
      data: { amount: 49800 },
    });

    const payment = order.payments[0]!;
    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: mockClient({
        session: session({
          id: payment.providerSessionId!,
          amountTotal: 49800,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
          paymentIntentId: payment.providerPaymentId!,
        }),
        paymentIntent: pi({
          id: payment.providerPaymentId!,
          amount: 49800,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
        }),
        refunds: [],
      }),
    });

    const refundClient = mockClient({
      session: session({
        id: payment.providerSessionId!,
        amountTotal: 49800,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        paymentIntentId: payment.providerPaymentId!,
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        amount: 49800,
        amountRefunded: 24900,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [
        {
          id: `re_partial_${order.id}`,
          amount: 24900,
          currency: "nok",
          status: "succeeded",
          paymentIntentId: payment.providerPaymentId!,
        },
      ],
    });

    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: refundClient,
    });

    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus
    ).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });

  it("webhook after reconcile remains idempotent", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;
    const client = mockClient({
      session: session({
        id: payment.providerSessionId!,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        paymentIntentId: payment.providerPaymentId!,
      }),
      paymentIntent: pi({
        id: payment.providerPaymentId!,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
      refunds: [],
    });

    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });

    await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody: JSON.stringify({
        id: `evt_after_recon_${order.id}`,
        type: "checkout.session.completed",
        orderId: order.id,
        sessionId: payment.providerSessionId,
        paymentId: payment.providerPaymentId,
        amount: 24900,
        currency: "NOK",
      }),
      signature: "mock",
    });

    const tickets = await prisma.ticket.findMany({ where: { orderId: order.id } });
    expect(tickets.length).toBe(1);
    expect(tickets.every((t) => t.status === TicketStatus.VALID)).toBe(true);
  });

  it("never downgrades PAID when session expired", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;

    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: mockClient({
        session: session({
          id: payment.providerSessionId!,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
          paymentIntentId: payment.providerPaymentId!,
        }),
        paymentIntent: pi({
          id: payment.providerPaymentId!,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
        }),
        refunds: [],
      }),
    });

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: mockClient({
        session: session({
          id: payment.providerSessionId!,
          status: "expired",
          paymentStatus: "unpaid",
          paymentIntentId: null,
          metadata: { orderId: order.id },
        }),
        paymentIntent: null,
        refunds: [],
      }),
    });

    expect(row.proposedAction).toBe("skip_conflict");
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus
    ).toBe(PaymentStatus.PAID);
  });

  it("pending open checkout with providerPaymentId=cs_ => no LOOKUP_ERROR", async () => {
    if (!dbReady) return;
    const csId = `cs_live_open_${Date.now()}`;
    // Legacy bug: both columns stored the Checkout Session id
    const order = await createPendingOrder({
      sessionId: csId,
      paymentId: csId,
    });

    const piCalls: string[] = [];
    const client: StripeLookupClient = {
      async retrieveSession(id) {
        expect(id).toBe(csId);
        return session({
          id: csId,
          status: "open",
          paymentStatus: "unpaid",
          paymentIntentId: null,
          metadata: { orderId: order.id },
        });
      },
      async retrievePaymentIntent(id) {
        piCalls.push(id);
        throw new Error(`should not retrieve PI with id=${id}`);
      },
      async listRefunds(id) {
        piCalls.push(`refunds:${id}`);
        return [];
      },
    };

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: false,
      stripeClient: client,
    });

    expect(row.anomalyReason).not.toBe("LOOKUP_ERROR");
    expect(row.anomalyReason).toBeNull();
    expect(row.proposedAction).toBe("none");
    expect(row.stripeSessionStatus).toBe("open");
    expect(row.stripeSessionPaymentStatus).toBe("unpaid");
    expect(row.stripePiStatus).toBeNull();
    expect(row.ticketlyStatus).toBe(PaymentStatus.PENDING);
    expect(piCalls).toEqual([]);
  });

  it("expired checkout with providerPaymentId=cs_ => mark_cancelled", async () => {
    if (!dbReady) return;
    const csId = `cs_live_expired_${Date.now()}`;
    const order = await createPendingOrder({
      sessionId: csId,
      paymentId: csId,
    });

    const client: StripeLookupClient = {
      async retrieveSession() {
        return session({
          id: csId,
          status: "expired",
          paymentStatus: "unpaid",
          paymentIntentId: null,
          metadata: { orderId: order.id },
        });
      },
      async retrievePaymentIntent() {
        throw new Error("must not call paymentIntents.retrieve with cs_");
      },
      async listRefunds() {
        return [];
      },
    };

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });

    expect(row.anomalyReason).not.toBe("LOOKUP_ERROR");
    expect(row.proposedAction).toBe("mark_cancelled");
    expect(row.anomalyReason).toBe("EXPIRED_SESSION_NO_PI");
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus
    ).toBe(PaymentStatus.CANCELLED);
  });

  it("paid checkout with providerPaymentId=cs_ finds PI from session.payment_intent", async () => {
    if (!dbReady) return;
    const csId = `cs_live_paid_${Date.now()}`;
    const realPi = `pi_live_from_session_${Date.now()}`;
    const order = await createPendingOrder({
      sessionId: csId,
      paymentId: csId,
    });

    const client: StripeLookupClient = {
      async retrieveSession(id) {
        expect(id).toBe(csId);
        return session({
          id: csId,
          status: "complete",
          paymentStatus: "paid",
          paymentIntentId: realPi,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
        });
      },
      async retrievePaymentIntent(id) {
        expect(id).toBe(realPi);
        expect(id.startsWith("cs_")).toBe(false);
        return pi({
          id: realPi,
          status: "succeeded",
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
        });
      },
      async listRefunds(id) {
        expect(id).toBe(realPi);
        return [];
      },
    };

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });

    expect(row.anomalyReason).not.toBe("LOOKUP_ERROR");
    expect(row.proposedAction).toBe("mark_paid");
    expect(row.applied).toBe(true);
    expect(row.stripePiStatus).toBe("succeeded");
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus
    ).toBe(PaymentStatus.PAID);
  });

  it("failed PI with legacy cs_ providerPaymentId => mark_failed", async () => {
    if (!dbReady) return;
    const csId = `cs_live_fail_${Date.now()}`;
    const realPi = `pi_live_fail_${Date.now()}`;
    const order = await createPendingOrder({
      sessionId: csId,
      paymentId: csId,
    });

    const client: StripeLookupClient = {
      async retrieveSession() {
        return session({
          id: csId,
          status: "open",
          paymentStatus: "unpaid",
          paymentIntentId: realPi,
          metadata: { orderId: order.id },
        });
      },
      async retrievePaymentIntent(id) {
        expect(id).toBe(realPi);
        return pi({
          id: realPi,
          status: "requires_payment_method",
          lastPaymentErrorCode: "card_declined",
          metadata: { orderId: order.id },
        });
      },
      async listRefunds() {
        return [];
      },
    };

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: client,
    });

    expect(row.anomalyReason).not.toBe("LOOKUP_ERROR");
    expect(row.proposedAction).toBe("mark_failed");
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus
    ).toBe(PaymentStatus.FAILED);
  });

  it("valid paid rows with real pi_ remain verify_ok", async () => {
    if (!dbReady) return;
    const order = await createPendingOrder();
    const payment = order.payments[0]!;

    await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: true,
      stripeClient: mockClient({
        session: session({
          id: payment.providerSessionId!,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
          paymentIntentId: payment.providerPaymentId!,
        }),
        paymentIntent: pi({
          id: payment.providerPaymentId!,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
        }),
        refunds: [],
      }),
    });

    const row = await PaymentReconciliationService.reconcileOrder(order.id, {
      apply: false,
      stripeClient: mockClient({
        session: session({
          id: payment.providerSessionId!,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
          paymentIntentId: payment.providerPaymentId!,
        }),
        paymentIntent: pi({
          id: payment.providerPaymentId!,
          metadata: { orderId: order.id, orderNumber: order.orderNumber },
        }),
        refunds: [],
      }),
    });

    expect(row.proposedAction).toBe("verify_ok");
    expect(row.anomalyReason).toBeNull();
    expect(row.ticketlyStatus).toBe(PaymentStatus.PAID);
  });
});
