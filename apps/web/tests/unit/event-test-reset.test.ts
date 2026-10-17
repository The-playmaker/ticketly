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
} from "@prisma/client";
import { AppError } from "@/lib/api-error";
import {
  generateSecureToken,
  generatePublicTicketId,
  hashTicketToken,
  encryptTicketToken,
} from "@/lib/tickets/token";
import {
  evaluateProductionGate,
  isTestCustomerEmail,
} from "@/services/event-test-reset-service";
import {
  EVENT_TEST_DATA_RESET_ACTION,
  PRODUCTION_EVENT_RESET_CONFIRMATION,
  TEST_EVENT_RESET_CONFIRMATION,
} from "@/lib/admin/event-test-reset";

const prisma = new PrismaClient();
const runDb = Boolean(process.env.DATABASE_URL);

const superAdminUser: {
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
    if (superAdminUser.globalRole !== GlobalRole.SUPER_ADMIN) {
      throw new AppError("FORBIDDEN", "Kun SUPER_ADMIN", 403);
    }
    return { user: superAdminUser, session: { user: superAdminUser } };
  }),
  requireAdminSession: vi.fn(async () => ({ user: superAdminUser })),
  requireEventAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Event test-reset wiring", () => {
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
    expect(formSrc).toContain("/api/admin/events/${eventId}/test-reset");
  });

  it("API route is SUPER_ADMIN only and documents confirmation", () => {
    const routeSrc = readFileSync(
      path.resolve(__dirname, "../../src/app/api/admin/events/[id]/test-reset/route.ts"),
      "utf8"
    );
    expect(routeSrc).toContain("requireSuperAdmin");
    expect(routeSrc).toContain("TEST_EVENT_RESET_CONFIRMATION");
    expect(routeSrc).toContain("ALLOW_PRODUCTION_EVENT_RESET");
  });

  it("test email markers classify correctly", () => {
    expect(isTestCustomerEmail("buyer@example.com")).toBe(true);
    expect(isTestCustomerEmail("x@test.local")).toBe(true);
    expect(isTestCustomerEmail("test+user@gmail.com")).toBe(true);
    expect(isTestCustomerEmail("real.customer@gmail.com")).toBe(false);
  });

  it("production gate blocks live paid revenue and real emails", () => {
    const blocked = evaluateProductionGate({
      eventStatus: EventStatus.PUBLISHED,
      paidRevenueOre: 50000,
      realCustomerPaidOrderCount: 1,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.reasons.length).toBeGreaterThan(0);

    const draftTestOnly = evaluateProductionGate({
      eventStatus: EventStatus.DRAFT,
      paidRevenueOre: 100,
      realCustomerPaidOrderCount: 0,
    });
    expect(draftTestOnly.blocked).toBe(false);
  });
});

describe.runIf(runDb)("POST /api/admin/events/[id]/test-reset", () => {
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
    superAdminUser.id = superAdmin.id;
    superAdminUser.email = superAdmin.email;
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

    const eventA = await prisma.event.create({
      data: {
        organizationId: orgId,
        sellerOrganizationId: orgId,
        name: `Reset Event A ${suffix}`,
        slug: `reset-a-${suffix}`,
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
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
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

    await prisma.payment.create({
      data: {
        orderId: orderAId,
        provider: PaymentProviderType.STRIPE,
        amount: 49800,
        currency: "NOK",
        status: PaymentStatus.PAID,
        providerPaymentId: `pi_reset_a_${suffix}`,
      },
    });

    await prisma.webhookEvent.create({
      data: {
        provider: PaymentProviderType.STRIPE,
        eventId: `evt_reset_a_${suffix}`,
        eventType: "payment_intent.succeeded",
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
        status: TicketStatus.VALID,
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

    // Untouched sibling event order
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
    superAdminUser.globalRole = GlobalRole.SUPER_ADMIN;
    delete process.env.ALLOW_PRODUCTION_EVENT_RESET;
    vi.clearAllMocks();
  });

  it("SUPER_ADMIN can dry-run and see inventory counts", async () => {
    const { POST } = await import("@/app/api/admin/events/[id]/test-reset/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/events/${eventAId}/test-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dryRun: boolean;
      counts: {
        orders: number;
        tickets: number;
        reservations: number;
        checkIns: number;
        payments: number;
        webhookEvents: number;
        notificationLogs: number;
        analyticsEvents: number;
        ticketTypes: Array<{ quantitySold: number; quantityReserved: number }>;
      };
    };
    expect(body.dryRun).toBe(true);
    expect(body.counts.orders).toBeGreaterThanOrEqual(1);
    expect(body.counts.tickets).toBeGreaterThanOrEqual(1);
    expect(body.counts.reservations).toBeGreaterThanOrEqual(1);
    expect(body.counts.checkIns).toBeGreaterThanOrEqual(1);
    expect(body.counts.payments).toBeGreaterThanOrEqual(1);
    expect(body.counts.webhookEvents).toBeGreaterThanOrEqual(1);
    expect(body.counts.notificationLogs).toBeGreaterThanOrEqual(1);
    expect(body.counts.analyticsEvents).toBeGreaterThanOrEqual(1);
    expect(body.counts.ticketTypes[0]?.quantitySold).toBe(2);
    expect(body.counts.ticketTypes[0]?.quantityReserved).toBe(2);
  });

  it("non-SUPER_ADMIN gets 403", async () => {
    superAdminUser.globalRole = GlobalRole.CUSTOMER;
    const { POST } = await import("@/app/api/admin/events/[id]/test-reset/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/events/${eventAId}/test-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(res.status).toBe(403);
  });

  it("wrong confirmation is rejected", async () => {
    const { POST } = await import("@/app/api/admin/events/[id]/test-reset/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/events/${eventAId}/test-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, confirmation: "wrong" }),
      }),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("resets event A and leaves event B untouched; preserves allocation/price", async () => {
    const { POST } = await import("@/app/api/admin/events/[id]/test-reset/route");
    const res = await POST(
      new Request(`http://localhost/api/admin/events/${eventAId}/test-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
          confirmation: TEST_EVENT_RESET_CONFIRMATION,
        }),
      }),
      { params: Promise.resolve({ id: eventAId }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dryRun: boolean;
      deleted: { orders: number; tickets: number };
      counts: { orders: number; tickets: number; reservations: number };
      preserved: { quantityReleased: true };
    };
    expect(body.dryRun).toBe(false);
    expect(body.deleted.orders).toBeGreaterThanOrEqual(1);
    expect(body.counts.orders).toBe(0);
    expect(body.counts.tickets).toBe(0);
    expect(body.counts.reservations).toBe(0);

    const ttA = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeAId } });
    expect(ttA.quantitySold).toBe(0);
    expect(ttA.quantityReserved).toBe(0);
    expect(ttA.quantityReleased).toBe(100);
    expect(ttA.quantityTotal).toBe(500);
    expect(ttA.price).toBe(24900);

    const eventA = await prisma.event.findUniqueOrThrow({ where: { id: eventAId } });
    expect(eventA.name).toContain("Reset Event A");
    expect(eventA.capacity).toBe(500);

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
        actorId: superAdminUser.id,
      },
    });
    expect(audit).toBeTruthy();
  });

  it("production gate blocks PUBLISHED event with paid real-customer revenue", async () => {
    // Seed a live event with a real customer email
    const live = await prisma.event.create({
      data: {
        organizationId: orgId,
        sellerOrganizationId: orgId,
        name: `Live Reset ${suffix}`,
        slug: `reset-live-${suffix}`,
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
        orderNumber: `TKT-RST-LIVE-${suffix}`,
        organizationId: orgId,
        sellerOrganizationId: orgId,
        eventId: live.id,
        customerEmail: `real.buyer.${suffix}@gmail.com`,
        customerFirstName: "Real",
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

    const { POST } = await import("@/app/api/admin/events/[id]/test-reset/route");

    const blocked = await POST(
      new Request(`http://localhost/api/admin/events/${live.id}/test-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
          confirmation: TEST_EVENT_RESET_CONFIRMATION,
        }),
      }),
      { params: Promise.resolve({ id: live.id }) }
    );
    expect(blocked.status).toBe(409);
    const err = (await blocked.json()) as { error: { code: string } };
    expect(err.error.code).toBe("PRODUCTION_EVENT_RESET_BLOCKED");

    // Still has the order
    expect(await prisma.order.count({ where: { eventId: live.id } })).toBe(1);

    // Override with env + stronger confirm works
    process.env.ALLOW_PRODUCTION_EVENT_RESET = "true";
    const allowed = await POST(
      new Request(`http://localhost/api/admin/events/${live.id}/test-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
          confirmation: TEST_EVENT_RESET_CONFIRMATION,
          allowProductionOverride: true,
          productionConfirmation: PRODUCTION_EVENT_RESET_CONFIRMATION,
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
