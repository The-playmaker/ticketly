import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  PrismaClient,
  GlobalRole,
  OrgRole,
  EventStatus,
  PaymentStatus,
  TicketStatus,
  ReservationStatus,
  CheckInResult,
  PaymentProviderType,
  RefundStatus,
} from "@prisma/client";
import { AppError } from "@/lib/api-error";
import {
  generateSecureToken,
  generatePublicTicketId,
  hashTicketToken,
  encryptTicketToken,
} from "@/lib/tickets/token";
import { evaluateFinancialSafetyGate } from "@/services/event-test-reset-service";
import {
  EMERGENCY_EVENT_RESET_CONFIRMATION,
  EVENT_TEST_DATA_RESET_ACTION,
  TEST_EVENT_RESET_CONFIRMATION,
} from "@/lib/admin/event-test-reset";

const prisma = new PrismaClient();
const runDb = Boolean(process.env.DATABASE_URL);

const sessionUser: {
  id: string;
  email: string;
  globalRole: GlobalRole;
  isActive: boolean;
  memberships: {
    organizationId: string;
    role: OrgRole;
    canRefund: boolean;
    isActive: boolean;
  }[];
} = {
  id: "placeholder",
  email: "super-reset@test.local",
  globalRole: GlobalRole.SUPER_ADMIN,
  isActive: true,
  memberships: [],
};

vi.mock("@/lib/admin/org-access", () => ({
  requireSuperAdmin: vi.fn(async () => {
    if (sessionUser.globalRole !== GlobalRole.SUPER_ADMIN) {
      throw new AppError("FORBIDDEN", "Kun SUPER_ADMIN", 403);
    }
    return { user: sessionUser, session: { user: sessionUser } };
  }),
  requireAdminSession: vi.fn(async () => ({ user: sessionUser })),
  requireEventAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Event reset-test-data wiring", () => {
  it("security + settings pages expose Nullstill testdata for SUPER_ADMIN", () => {
    const securitySrc = readFileSync(
      path.resolve(__dirname, "../../src/app/admin/events/[id]/security/page.tsx"),
      "utf8"
    );
    expect(securitySrc).toContain("EventTestResetForm");
    expect(securitySrc).toContain("isSuperAdmin(user)");

    const settingsSrc = readFileSync(
      path.resolve(__dirname, "../../src/app/admin/events/[id]/settings/page.tsx"),
      "utf8"
    );
    expect(settingsSrc).toContain("EventTestResetForm");

    const formSrc = readFileSync(
      path.resolve(__dirname, "../../src/components/admin/event-test-reset-form.tsx"),
      "utf8"
    );
    expect(formSrc).toContain("Nullstill testdata");
    expect(formSrc).toContain(TEST_EVENT_RESET_CONFIRMATION);
    expect(formSrc).toContain(
      "Dette sletter lokale testordre, billetter, refusjoner, reservasjoner og analyse"
    );
    expect(formSrc).toContain("/api/admin/events/${eventId}/reset-test-data");
  });

  it("preferred API route is SUPER_ADMIN only with GET dry-run + POST confirm", () => {
    const routeSrc = readFileSync(
      path.resolve(
        __dirname,
        "../../src/app/api/admin/events/[id]/reset-test-data/route.ts"
      ),
      "utf8"
    );
    expect(routeSrc).toContain("requireSuperAdmin");
    expect(routeSrc).toContain("TEST_EVENT_RESET_CONFIRMATION");
    expect(routeSrc).toContain("export async function GET");
    expect(routeSrc).toContain("export async function POST");
    expect(routeSrc).toContain("ALLOW_PRODUCTION_EVENT_RESET");
  });

  it("financial safety gate blocks unsettled statuses and allows refunded-only", () => {
    const blocked = evaluateFinancialSafetyGate({
      unsettledByStatus: { PAID: 1, AUTHORIZED: 1 },
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.reasons.length).toBeGreaterThan(0);

    const ok = evaluateFinancialSafetyGate({ unsettledByStatus: {} });
    expect(ok.blocked).toBe(false);

    const partial = evaluateFinancialSafetyGate({
      unsettledByStatus: { PARTIALLY_REFUNDED: 2 },
    });
    expect(partial.blocked).toBe(true);

    const review = evaluateFinancialSafetyGate({
      unsettledByStatus: { REVIEW_REQUIRED: 1 },
    });
    expect(review.blocked).toBe(true);
  });
});

describe.runIf(runDb)("GET|POST /api/admin/events/[id]/reset-test-data", () => {
  const suffix = Date.now().toString(36);
  const orgIds: string[] = [];
  const eventIds: string[] = [];
  const userIds: string[] = [];

  let orgId = "";
  let eventAId = "";
  let eventBId = "";
  let ticketTypeAId = "";
  let ticketTypeBId = "";
  let orderAId = "";
  let orderBId = "";
  let ticketAId = "";
  let eventASlug = "";
  let eventAName = "";

  beforeAll(async () => {
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";
    delete process.env.ALLOW_PRODUCTION_EVENT_RESET;

    const superAdmin = await prisma.user.create({
      data: {
        email: `super-reset-${suffix}@test.local`,
        globalRole: GlobalRole.SUPER_ADMIN,
        isActive: true,
        name: "Super Reset",
      },
    });
    sessionUser.id = superAdmin.id;
    sessionUser.email = superAdmin.email;
    userIds.push(superAdmin.id);

    const org = await prisma.organization.create({
      data: {
        name: `Reset Org ${suffix}`,
        slug: `reset-org-${suffix}`,
        legalName: `Reset Org AS ${suffix}`,
        organizationNumber: "999888777",
        isActive: true,
      },
    });
    orgId = org.id;
    orgIds.push(org.id);

    eventAName = `Reset Event A ${suffix}`;
    eventASlug = `reset-a-${suffix}`;
    const eventA = await prisma.event.create({
      data: {
        organizationId: orgId,
        sellerOrganizationId: orgId,
        name: eventAName,
        slug: eventASlug,
        startsAt: new Date(Date.now() + 7 * 86400_000),
        endsAt: new Date(Date.now() + 7 * 86400_000 + 3 * 3600_000),
        timezone: "Europe/Oslo",
        capacity: 500,
        status: EventStatus.DRAFT,
        visibility: "PUBLIC",
        currency: "NOK",
        city: "Oslo",
      },
    });
    eventAId = eventA.id;
    eventIds.push(eventA.id);

    const eventB = await prisma.event.create({
      data: {
        organizationId: orgId,
        sellerOrganizationId: orgId,
        name: `Reset Event B ${suffix}`,
        slug: `reset-b-${suffix}`,
        startsAt: new Date(Date.now() + 14 * 86400_000),
        endsAt: new Date(Date.now() + 14 * 86400_000 + 3 * 3600_000),
        timezone: "Europe/Oslo",
        capacity: 100,
        status: EventStatus.DRAFT,
        visibility: "PUBLIC",
        currency: "NOK",
        city: "Oslo",
      },
    });
    eventBId = eventB.id;
    eventIds.push(eventB.id);

    const ttA = await prisma.ticketType.create({
      data: {
        eventId: eventAId,
        name: "Ordinær A",
        price: 24900,
        quantityTotal: 500,
        quantityReleased: 100,
        quantitySold: 2,
        quantityReserved: 2,
        maxPerOrder: 6,
        minPerOrder: 1,
        isVisible: true,
        isPubliclyPurchasable: true,
      },
    });
    ticketTypeAId = ttA.id;

    const ttB = await prisma.ticketType.create({
      data: {
        eventId: eventBId,
        name: "Ordinær B",
        price: 19900,
        quantityTotal: 100,
        quantityReleased: 50,
        quantitySold: 3,
        quantityReserved: 1,
        maxPerOrder: 4,
        minPerOrder: 1,
        isVisible: true,
        isPubliclyPurchasable: true,
      },
    });
    ticketTypeBId = ttB.id;

    // Fully refunded financial order — allowed path
    const orderA = await prisma.order.create({
      data: {
        orderNumber: `TKT-RST-A-${suffix}`,
        organizationId: orgId,
        sellerOrganizationId: orgId,
        eventId: eventAId,
        customerEmail: `buyer-a-${suffix}@example.com`,
        customerFirstName: "Buyer",
        customerLastName: "A",
        subtotal: 49800,
        serviceFee: 0,
        tax: 0,
        discount: 0,
        total: 49800,
        paymentStatus: PaymentStatus.REFUNDED,
        orderStatus: "REFUNDED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: ticketTypeAId,
            quantity: 2,
            unitPrice: 24900,
            serviceFee: 0,
            tax: 0,
            total: 49800,
            name: "Ordinær A",
          },
        },
      },
      include: { items: true },
    });
    orderAId = orderA.id;

    const paymentA = await prisma.payment.create({
      data: {
        orderId: orderAId,
        provider: PaymentProviderType.STRIPE,
        amount: 49800,
        currency: "NOK",
        status: PaymentStatus.REFUNDED,
        providerPaymentId: `pi_reset_a_${suffix}`,
      },
    });

    await prisma.refund.create({
      data: {
        orderId: orderAId,
        paymentId: paymentA.id,
        amount: 49800,
        currency: "NOK",
        status: RefundStatus.SUCCEEDED,
        reason: "test reset fixture",
        ticketIds: [],
      },
    });

    await prisma.webhookEvent.create({
      data: {
        provider: PaymentProviderType.STRIPE,
        eventId: `evt_reset_a_${suffix}`,
        eventType: "charge.refunded",
        orderId: orderAId,
        payload: { test: true },
        status: "PROCESSED",
      },
    });

    await prisma.notificationLog.create({
      data: {
        eventId: eventAId,
        orderId: orderAId,
        channel: "EMAIL",
        category: "TRANSACTIONAL",
        title: "Test",
        body: "Test body",
        status: "SENT",
      },
    });

    await prisma.analyticsEvent.create({
      data: {
        eventId: eventAId,
        type: "PAYMENT_SUCCESS",
        orderId: orderAId,
      },
    });

    await prisma.ticketReservation.create({
      data: {
        eventId: eventAId,
        ticketTypeId: ticketTypeAId,
        quantity: 2,
        sessionId: `reset-res-${suffix}`,
        status: ReservationStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });

    await prisma.waitlistEntry.create({
      data: {
        eventId: eventAId,
        ticketTypeId: ticketTypeAId,
        email: `wait-${suffix}@example.com`,
        name: "Waiter",
        requestedQuantity: 1,
      },
    });

    const token = generateSecureToken();
    const ticket = await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(token),
        tokenCipher: encryptTicketToken(token),
        secureToken: null,
        orderId: orderA.id,
        orderItemId: orderA.items[0]!.id,
        eventId: eventAId,
        ticketTypeId: ticketTypeAId,
        holderName: "Buyer A",
        holderEmail: `buyer-a-${suffix}@example.com`,
        status: TicketStatus.CHECKED_IN,
        checkedInAt: new Date(),
      },
    });
    ticketAId = ticket.id;

    await prisma.checkIn.create({
      data: {
        ticketId: ticketAId,
        eventId: eventAId,
        result: CheckInResult.SUCCESS,
      },
    });

    // Untouched sibling event order (PAID — must remain)
    const orderB = await prisma.order.create({
      data: {
        orderNumber: `TKT-RST-B-${suffix}`,
        organizationId: orgId,
        sellerOrganizationId: orgId,
        eventId: eventBId,
        customerEmail: `buyer-b-${suffix}@example.com`,
        customerFirstName: "Buyer",
        customerLastName: "B",
        subtotal: 19900,
        serviceFee: 0,
        tax: 0,
        discount: 0,
        total: 19900,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: ticketTypeBId,
            quantity: 1,
            unitPrice: 19900,
            serviceFee: 0,
            tax: 0,
            total: 19900,
            name: "Ordinær B",
          },
        },
      },
    });
    orderBId = orderB.id;
  });

  afterAll(async () => {
    for (const eventId of eventIds) {
      const orders = await prisma.order.findMany({
        where: { eventId },
        select: { id: true },
      });
      const orderIds = orders.map((o) => o.id);
      const tickets = await prisma.ticket.findMany({
        where: { eventId },
        select: { id: true },
      });
      const ticketIds = tickets.map((t) => t.id);

      await prisma.checkIn.deleteMany({ where: { eventId } });
      if (ticketIds.length) {
        await prisma.ticketTransfer.deleteMany({ where: { ticketId: { in: ticketIds } } });
        await prisma.walletPass.deleteMany({ where: { ticketId: { in: ticketIds } } });
        await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
      }
      if (orderIds.length) {
        await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderSnapshot.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.webhookEvent.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      }
      await prisma.notificationLog.deleteMany({ where: { eventId } });
      await prisma.analyticsEvent.deleteMany({ where: { eventId } });
      await prisma.ticketReservation.deleteMany({ where: { eventId } });
      await prisma.waitlistEntry.deleteMany({ where: { eventId } });
      await prisma.eventReminderJob.deleteMany({ where: { eventId } });
      await prisma.ticketType.deleteMany({ where: { eventId } });
      await prisma.auditLog.deleteMany({
        where: { entityType: "Event", entityId: eventId },
      });
      await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
    }
    if (orgIds.length) {
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => {
    sessionUser.globalRole = GlobalRole.SUPER_ADMIN;
    delete process.env.ALLOW_PRODUCTION_EVENT_RESET;
    vi.clearAllMocks();
  });

  it("GET dry-run shows event/org and inventory counts", async () => {
    const { GET } = await import("@/app/api/admin/events/[id]/reset-test-data/route");
    const res = await GET(
      new Request(`http://localhost/api/admin/events/${eventAId}/reset-test-data`),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dryRun: boolean;
      eventId: string;
      eventName: string;
      organizationName: string;
      safetyGate: { blocked: boolean };
      counts: {
        orders: number;
        refundedOrders: number;
        paidOrders: number;
        tickets: number;
        checkedInTickets: number;
        reservations: number;
        checkIns: number;
        payments: number;
        refunds: number;
        webhookEvents: number;
        notificationLogs: number;
        analyticsEvents: number;
        waitlistEntries: number;
        ticketTypes: Array<{ quantitySold: number; quantityReserved: number }>;
      };
    };
    expect(body.dryRun).toBe(true);
    expect(body.eventId).toBe(eventAId);
    expect(body.eventName).toBe(eventAName);
    expect(body.organizationName).toContain("Reset Org");
    expect(body.safetyGate.blocked).toBe(false);
    expect(body.counts.orders).toBeGreaterThanOrEqual(1);
    expect(body.counts.refundedOrders).toBeGreaterThanOrEqual(1);
    expect(body.counts.paidOrders).toBe(0);
    expect(body.counts.tickets).toBeGreaterThanOrEqual(1);
    expect(body.counts.checkedInTickets).toBeGreaterThanOrEqual(1);
    expect(body.counts.reservations).toBeGreaterThanOrEqual(1);
    expect(body.counts.checkIns).toBeGreaterThanOrEqual(1);
    expect(body.counts.payments).toBeGreaterThanOrEqual(1);
    expect(body.counts.refunds).toBeGreaterThanOrEqual(1);
    expect(body.counts.webhookEvents).toBeGreaterThanOrEqual(1);
    expect(body.counts.notificationLogs).toBeGreaterThanOrEqual(1);
    expect(body.counts.analyticsEvents).toBeGreaterThanOrEqual(1);
    expect(body.counts.waitlistEntries).toBeGreaterThanOrEqual(1);
    expect(body.counts.ticketTypes[0]?.quantitySold).toBe(2);
    expect(body.counts.ticketTypes[0]?.quantityReserved).toBe(2);
  });

  it("SUPER_ADMIN only; organizer denied", async () => {
    sessionUser.globalRole = GlobalRole.CUSTOMER;
    sessionUser.memberships = [
      {
        organizationId: orgId,
        role: OrgRole.ORGANIZER_ADMIN,
        canRefund: true,
        isActive: true,
      },
    ];
    const { GET, POST } = await import(
      "@/app/api/admin/events/[id]/reset-test-data/route"
    );
    const getRes = await GET(
      new Request(`http://localhost/api/admin/events/${eventAId}/reset-test-data`),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(getRes.status).toBe(403);

    const postRes = await POST(
      new Request(`http://localhost/api/admin/events/${eventAId}/reset-test-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: TEST_EVENT_RESET_CONFIRMATION }),
      }),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(postRes.status).toBe(403);
  });

  it("wrong confirmation is rejected", async () => {
    const { POST } = await import("@/app/api/admin/events/[id]/reset-test-data/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/events/${eventAId}/reset-test-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "wrong" }),
      }),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("blocks with active PAID order", async () => {
    const paidEvent = await prisma.event.create({
      data: {
        organizationId: orgId,
        sellerOrganizationId: orgId,
        name: `Paid Block ${suffix}`,
        slug: `reset-paid-${suffix}`,
        startsAt: new Date(Date.now() + 3 * 86400_000),
        endsAt: new Date(Date.now() + 3 * 86400_000 + 3600_000),
        timezone: "Europe/Oslo",
        capacity: 50,
        status: EventStatus.DRAFT,
        visibility: "PUBLIC",
        currency: "NOK",
        city: "Oslo",
      },
    });
    eventIds.push(paidEvent.id);

    const tt = await prisma.ticketType.create({
      data: {
        eventId: paidEvent.id,
        name: "Paid",
        price: 10000,
        quantityTotal: 50,
        quantityReleased: 50,
        quantitySold: 1,
        quantityReserved: 0,
      },
    });

    await prisma.order.create({
      data: {
        orderNumber: `TKT-RST-PAID-${suffix}`,
        organizationId: orgId,
        sellerOrganizationId: orgId,
        eventId: paidEvent.id,
        customerEmail: `paid.${suffix}@example.com`,
        customerFirstName: "Paid",
        customerLastName: "Buyer",
        subtotal: 10000,
        total: 10000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: tt.id,
            quantity: 1,
            unitPrice: 10000,
            total: 10000,
            name: "Paid",
          },
        },
      },
    });

    const { GET, POST } = await import(
      "@/app/api/admin/events/[id]/reset-test-data/route"
    );
    const preview = await GET(
      new Request(`http://localhost/api/admin/events/${paidEvent.id}/reset-test-data`),
      { params: Promise.resolve({ id: paidEvent.id }) }
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      safetyGate: { blocked: boolean; reasons: string[] };
    };
    expect(previewBody.safetyGate.blocked).toBe(true);

    const blocked = await POST(
      new Request(`http://localhost/api/admin/events/${paidEvent.id}/reset-test-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: TEST_EVENT_RESET_CONFIRMATION }),
      }),
      { params: Promise.resolve({ id: paidEvent.id }) }
    );
    expect(blocked.status).toBe(409);
    const err = (await blocked.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("EVENT_RESET_BLOCKED_UNREFUNDED");
    expect(err.error.message).toMatch(/fullt refundert/i);
    expect(await prisma.order.count({ where: { eventId: paidEvent.id } })).toBe(1);
  });

  it("allows when all financial orders fully refunded; resets inventory; preserves event B + metadata", async () => {
    const { POST } = await import("@/app/api/admin/events/[id]/reset-test-data/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/events/${eventAId}/reset-test-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: TEST_EVENT_RESET_CONFIRMATION }),
      }),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dryRun: boolean;
      deleted: {
        orders: number;
        tickets: number;
        checkIns: number;
        reservations: number;
        waitlistEntries: number;
      };
      counts: { orders: number; tickets: number; reservations: number; checkIns: number };
      preserved: { quantityReleased: true; stripeExternal: true };
    };
    expect(body.dryRun).toBe(false);
    expect(body.deleted.orders).toBeGreaterThanOrEqual(1);
    expect(body.deleted.tickets).toBeGreaterThanOrEqual(1);
    expect(body.deleted.checkIns).toBeGreaterThanOrEqual(1);
    expect(body.deleted.reservations).toBeGreaterThanOrEqual(1);
    expect(body.counts.orders).toBe(0);
    expect(body.counts.tickets).toBe(0);
    expect(body.counts.reservations).toBe(0);
    expect(body.counts.checkIns).toBe(0);
    expect(body.preserved.stripeExternal).toBe(true);

    const ttA = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeAId } });
    expect(ttA.quantitySold).toBe(0);
    expect(ttA.quantityReserved).toBe(0);
    expect(ttA.quantityReleased).toBe(100);
    expect(ttA.quantityTotal).toBe(500);
    expect(ttA.price).toBe(24900);

    const eventA = await prisma.event.findUniqueOrThrow({ where: { id: eventAId } });
    expect(eventA.name).toBe(eventAName);
    expect(eventA.slug).toBe(eventASlug);
    expect(eventA.capacity).toBe(500);
    expect(eventA.organizationId).toBe(orgId);
    expect(eventA.sellerOrganizationId).toBe(orgId);

    expect(await prisma.order.count({ where: { id: orderAId } })).toBe(0);
    expect(await prisma.ticket.count({ where: { eventId: eventAId } })).toBe(0);
    expect(await prisma.checkIn.count({ where: { eventId: eventAId } })).toBe(0);
    expect(await prisma.ticketReservation.count({ where: { eventId: eventAId } })).toBe(0);
    expect(await prisma.waitlistEntry.count({ where: { eventId: eventAId } })).toBe(0);

    // Event B untouched
    expect(await prisma.order.count({ where: { id: orderBId } })).toBe(1);
    const ttB = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeBId } });
    expect(ttB.quantitySold).toBe(3);
    expect(ttB.quantityReserved).toBe(1);
    expect(ttB.quantityReleased).toBe(50);
    expect(ttB.price).toBe(19900);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: EVENT_TEST_DATA_RESET_ACTION,
        entityId: eventAId,
        actorId: sessionUser.id,
      },
    });
    expect(audit).toBeTruthy();
    const meta = audit?.metadata as {
      eventId?: string;
      actorId?: string;
      timestamp?: string;
      ticketTypeCountersBefore?: unknown;
      ticketTypeCountersAfter?: unknown;
      countsDeleted?: unknown;
    } | null;
    expect(meta?.eventId).toBe(eventAId);
    expect(meta?.actorId).toBe(sessionUser.id);
    expect(meta?.timestamp).toBeTruthy();
    expect(meta?.ticketTypeCountersBefore).toBeTruthy();
    expect(meta?.ticketTypeCountersAfter).toBeTruthy();
    expect(meta?.countsDeleted).toBeTruthy();
  });

  it("emergency override can bypass refunded-only when env enabled", async () => {
    const live = await prisma.event.create({
      data: {
        organizationId: orgId,
        sellerOrganizationId: orgId,
        name: `Emergency Reset ${suffix}`,
        slug: `reset-emerg-${suffix}`,
        startsAt: new Date(Date.now() + 3 * 86400_000),
        endsAt: new Date(Date.now() + 3 * 86400_000 + 3600_000),
        timezone: "Europe/Oslo",
        capacity: 50,
        status: EventStatus.PUBLISHED,
        visibility: "PUBLIC",
        currency: "NOK",
        city: "Oslo",
      },
    });
    eventIds.push(live.id);

    const tt = await prisma.ticketType.create({
      data: {
        eventId: live.id,
        name: "Live",
        price: 10000,
        quantityTotal: 50,
        quantityReleased: 50,
        quantitySold: 1,
        quantityReserved: 0,
      },
    });

    await prisma.order.create({
      data: {
        orderNumber: `TKT-RST-EMERG-${suffix}`,
        organizationId: orgId,
        sellerOrganizationId: orgId,
        eventId: live.id,
        customerEmail: `emerg.${suffix}@gmail.com`,
        customerFirstName: "Emerg",
        customerLastName: "Buyer",
        subtotal: 10000,
        total: 10000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: tt.id,
            quantity: 1,
            unitPrice: 10000,
            total: 10000,
            name: "Live",
          },
        },
      },
    });

    const { POST } = await import("@/app/api/admin/events/[id]/reset-test-data/route");

    process.env.ALLOW_PRODUCTION_EVENT_RESET = "true";
    const allowed = await POST(
      new Request(`http://localhost/api/admin/events/${live.id}/reset-test-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: TEST_EVENT_RESET_CONFIRMATION,
          allowEmergencyOverride: true,
          emergencyConfirmation: EMERGENCY_EVENT_RESET_CONFIRMATION,
        }),
      }),
      { params: Promise.resolve({ id: live.id }) }
    );
    expect(allowed.status).toBe(200);
    expect(await prisma.order.count({ where: { eventId: live.id } })).toBe(0);
    const ttAfter = await prisma.ticketType.findUniqueOrThrow({ where: { id: tt.id } });
    expect(ttAfter.quantitySold).toBe(0);
    expect(ttAfter.quantityReleased).toBe(50);
    expect(ttAfter.price).toBe(10000);
  });
});
