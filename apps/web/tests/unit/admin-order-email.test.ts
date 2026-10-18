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
  PaymentProviderType,
} from "@prisma/client";
import { AppError } from "@/lib/api-error";
import {
  generateSecureToken,
  generatePublicTicketId,
  hashTicketToken,
  encryptTicketToken,
} from "@/lib/tickets/token";

const prisma = new PrismaClient();
const runDb = Boolean(process.env.DATABASE_URL);

const actor = {
  id: "placeholder",
  email: "admin-order-email@test.local",
  globalRole: GlobalRole.SUPER_ADMIN as GlobalRole,
  isActive: true,
  memberships: [] as {
    organizationId: string;
    role: OrgRole;
    canRefund: boolean;
    isActive: boolean;
  }[],
};

vi.mock("@/lib/admin/org-access", () => ({
  requireAdminSession: vi.fn(async () => ({ user: actor })),
  requireOrderManageAccess: vi.fn(async (orderNumber: string) => {
    const order = await prisma.order.findUnique({ where: { orderNumber } });
    if (!order) throw new AppError("NOT_FOUND", "Ordre ikke funnet", 404);
    if (actor.globalRole === GlobalRole.SUPER_ADMIN && actor.isActive) {
      return { user: actor, session: { user: actor }, order };
    }
    const membership = actor.memberships.find(
      (m) => m.organizationId === order.organizationId && m.isActive
    );
    const allowed =
      membership &&
      (membership.role === OrgRole.ORGANIZER_ADMIN ||
        membership.role === OrgRole.EVENT_MANAGER);
    if (!allowed) throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
    return { user: actor, session: { user: actor }, order };
  }),
}));

vi.mock("@/lib/email/provider", () => ({
  getEmailProvider: () => ({
    send: vi.fn(async () => ({ id: "mock-email-id" })),
  }),
}));

function src(rel: string) {
  return readFileSync(path.resolve(__dirname, "../../src", rel), "utf8");
}

describe("Admin order email UI wiring", () => {
  it("order detail mounts Kunde & levering panel without accessToken", () => {
    const page = src("app/admin/orders/[orderNumber]/page.tsx");
    expect(page).toContain("OrderCustomerEmailPanel");
    expect(page).toContain("canResend");
    expect(page).not.toContain("accessToken={");
    expect(page).not.toContain("order.accessToken");

    const panel = src("components/admin/order-customer-email-panel.tsx");
    expect(panel).toContain("Kunde & levering");
    expect(panel).toContain("Lagre e-post");
    expect(panel).toContain("Send billett på nytt");
    expect(panel).toContain("Lagre og send på nytt");
    expect(panel).toContain("/api/admin/orders/${orderNumber}/customer-email");
    expect(panel).toContain("/api/admin/orders/${orderNumber}/resend-email");
    expect(panel).not.toContain("accessToken");
  });

  it("admin APIs use requireOrderManageAccess and audit actions", () => {
    const emailRoute = src("app/api/admin/orders/[orderNumber]/customer-email/route.ts");
    expect(emailRoute).toContain("requireOrderManageAccess");
    expect(emailRoute).toContain("OrderEmailService.updateCustomerEmail");

    const resendRoute = src("app/api/admin/orders/[orderNumber]/resend-email/route.ts");
    expect(resendRoute).toContain("requireOrderManageAccess");
    expect(resendRoute).toContain("OrderEmailService.resendOrderEmails");

    const service = src("services/order-email-service.ts");
    expect(service).toContain("ORDER_CUSTOMER_EMAIL_CHANGED");
    expect(service).toContain("ORDER_EMAIL_RESENT");
    expect(service).toContain("PARTIALLY_REFUNDED");
    expect(service).not.toContain("stripe");
  });
});

describe.runIf(runDb)("Admin order customer email + resend APIs", () => {
  const suffix = Date.now().toString(36);
  const orgIds: string[] = [];
  const eventIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const ticketIds: string[] = [];
  const ticketTypeIds: string[] = [];
  const paymentIds: string[] = [];

  let orgAId = "";
  let orgBId = "";
  let eventAId = "";
  let ticketTypeAId = "";
  let paidOrderNumber = "";
  let paidOrderId = "";
  let pendingOrderNumber = "";
  let pendingOrderId = "";
  let stripePaymentId = "";
  let organizerUserId = "";
  let foreignUserId = "";

  beforeAll(async () => {
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";
    process.env.APP_URL = process.env.APP_URL ?? "http://localhost:3456";

    const superAdmin = await prisma.user.create({
      data: {
        email: `sa-order-email-${suffix}@test.local`,
        globalRole: GlobalRole.SUPER_ADMIN,
        isActive: true,
        name: "Super Order Email",
      },
    });
    actor.id = superAdmin.id;
    actor.email = superAdmin.email;
    actor.globalRole = GlobalRole.SUPER_ADMIN;
    actor.memberships = [];
    userIds.push(superAdmin.id);

    const orgA = await prisma.organization.create({
      data: {
        name: `Email Org A ${suffix}`,
        slug: `email-org-a-${suffix}`,
        legalName: `Email Org A AS ${suffix}`,
        organizationNumber: "101202303",
        isActive: true,
      },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: `Email Org B ${suffix}`,
        slug: `email-org-b-${suffix}`,
        legalName: `Email Org B AS ${suffix}`,
        organizationNumber: "404505606",
        isActive: true,
      },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;
    orgIds.push(orgA.id, orgB.id);

    const organizer = await prisma.user.create({
      data: {
        email: `org-admin-${suffix}@test.local`,
        globalRole: GlobalRole.CUSTOMER,
        isActive: true,
        name: "Org Admin",
        memberships: {
          create: {
            organizationId: orgAId,
            role: OrgRole.ORGANIZER_ADMIN,
            canRefund: true,
            isActive: true,
          },
        },
      },
      include: { memberships: true },
    });
    organizerUserId = organizer.id;
    userIds.push(organizer.id);

    const foreign = await prisma.user.create({
      data: {
        email: `foreign-admin-${suffix}@test.local`,
        globalRole: GlobalRole.CUSTOMER,
        isActive: true,
        name: "Foreign Admin",
        memberships: {
          create: {
            organizationId: orgBId,
            role: OrgRole.ORGANIZER_ADMIN,
            canRefund: true,
            isActive: true,
          },
        },
      },
      include: { memberships: true },
    });
    foreignUserId = foreign.id;
    userIds.push(foreign.id);

    const event = await prisma.event.create({
      data: {
        organizationId: orgAId,
        sellerOrganizationId: orgAId,
        name: `Email Event ${suffix}`,
        slug: `email-event-${suffix}`,
        capacity: 100,
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        status: EventStatus.PUBLISHED,
        visibility: "PUBLIC",
      },
    });
    eventAId = event.id;
    eventIds.push(event.id);

    const tt = await prisma.ticketType.create({
      data: {
        eventId: eventAId,
        name: "Standard",
        price: 20000,
        quantityTotal: 50,
        quantityReleased: 50,
        quantitySold: 1,
        quantityReserved: 0,
        maxPerOrder: 4,
        minPerOrder: 1,
        sortOrder: 0,
        isVisible: true,
        isPubliclyPurchasable: true,
      },
    });
    ticketTypeAId = tt.id;
    ticketTypeIds.push(tt.id);

    paidOrderNumber = `TKT-EMAIL-PAID-${suffix}`;
    const paid = await prisma.order.create({
      data: {
        orderNumber: paidOrderNumber,
        organizationId: orgAId,
        sellerOrganizationId: orgAId,
        eventId: eventAId,
        customerEmail: `buyer-paid-${suffix}@example.com`,
        customerFirstName: "Paid",
        customerLastName: "Buyer",
        subtotal: 20000,
        serviceFee: 0,
        tax: 0,
        discount: 0,
        total: 20000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        ticketsFulfilledAt: new Date(),
        items: {
          create: {
            ticketTypeId: ticketTypeAId,
            quantity: 1,
            unitPrice: 20000,
            serviceFee: 0,
            tax: 0,
            total: 20000,
            name: "Standard",
          },
        },
      },
      include: { items: true },
    });
    paidOrderId = paid.id;
    orderIds.push(paid.id);

    const payment = await prisma.payment.create({
      data: {
        orderId: paid.id,
        provider: PaymentProviderType.STRIPE,
        providerPaymentId: `pi_test_${suffix}`,
        providerSessionId: `cs_test_${suffix}`,
        amount: 20000,
        currency: "NOK",
        status: PaymentStatus.PAID,
        providerStatus: "succeeded",
      },
    });
    stripePaymentId = payment.id;
    paymentIds.push(payment.id);

    const token = generateSecureToken();
    const ticket = await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(token),
        tokenCipher: encryptTicketToken(token),
        secureToken: null,
        orderId: paid.id,
        orderItemId: paid.items[0]!.id,
        eventId: eventAId,
        ticketTypeId: ticketTypeAId,
        holderName: "Paid Buyer",
        holderEmail: `buyer-paid-${suffix}@example.com`,
        status: TicketStatus.VALID,
      },
    });
    ticketIds.push(ticket.id);

    pendingOrderNumber = `TKT-EMAIL-PEND-${suffix}`;
    const pending = await prisma.order.create({
      data: {
        orderNumber: pendingOrderNumber,
        organizationId: orgAId,
        sellerOrganizationId: orgAId,
        eventId: eventAId,
        customerEmail: `buyer-pend-${suffix}@example.com`,
        customerFirstName: "Pending",
        customerLastName: "Buyer",
        subtotal: 20000,
        serviceFee: 0,
        tax: 0,
        discount: 0,
        total: 20000,
        paymentStatus: PaymentStatus.PENDING,
        orderStatus: "PENDING",
        items: {
          create: {
            ticketTypeId: ticketTypeAId,
            quantity: 1,
            unitPrice: 20000,
            serviceFee: 0,
            tax: 0,
            total: 20000,
            name: "Standard",
          },
        },
      },
    });
    pendingOrderId = pending.id;
    orderIds.push(pending.id);
  });

  afterAll(async () => {
    if (ticketIds.length) {
      await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    }
    if (paymentIds.length) {
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (orderIds.length) {
      await prisma.notificationLog.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (ticketTypeIds.length) {
      await prisma.ticketType.deleteMany({ where: { id: { in: ticketTypeIds } } });
    }
    if (eventIds.length) {
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (orgIds.length) {
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    actor.id = userIds[0]!;
    actor.globalRole = GlobalRole.SUPER_ADMIN;
    actor.memberships = [];
    actor.isActive = true;
    vi.clearAllMocks();

    await prisma.order.update({
      where: { id: paidOrderId },
      data: { customerEmail: `buyer-paid-${suffix}@example.com` },
    });
  });

  it("SUPER_ADMIN can correct customer email and writes audit", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/orders/[orderNumber]/customer-email/route"
    );
    const newEmail = `corrected-${suffix}@example.com`;

    const res = await PATCH(
      new Request(`http://localhost/api/admin/orders/${paidOrderNumber}/customer-email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      }),
      { params: Promise.resolve({ orderNumber: paidOrderNumber }) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email: string;
      audit: { action: string } | null;
    };
    expect(body.email).toBe(newEmail);
    expect(body.audit?.action).toBe("ORDER_CUSTOMER_EMAIL_CHANGED");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: paidOrderId } });
    expect(order.customerEmail).toBe(newEmail);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: paidOrderId, action: "ORDER_CUSTOMER_EMAIL_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorId).toBe(actor.id);
    const meta = audit?.metadata as Record<string, string>;
    expect(meta.oldEmail).toBe(`buyer-paid-${suffix}@example.com`);
    expect(meta.newEmail).toBe(newEmail);
    expect(meta.orderNumber).toBe(paidOrderNumber);
    expect(meta).not.toHaveProperty("accessToken");
  });

  it("organizer with correct org access can correct email", async () => {
    const organizer = await prisma.user.findUniqueOrThrow({
      where: { id: organizerUserId },
      include: { memberships: true },
    });
    actor.id = organizer.id;
    actor.email = organizer.email;
    actor.globalRole = GlobalRole.CUSTOMER;
    actor.memberships = organizer.memberships.map((m) => ({
      organizationId: m.organizationId,
      role: m.role,
      canRefund: m.canRefund,
      isActive: m.isActive,
    }));

    const { PATCH } = await import(
      "@/app/api/admin/orders/[orderNumber]/customer-email/route"
    );
    const newEmail = `org-corrected-${suffix}@example.com`;
    const res = await PATCH(
      new Request(`http://localhost/api/admin/orders/${paidOrderNumber}/customer-email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      }),
      { params: Promise.resolve({ orderNumber: paidOrderNumber }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe(newEmail);
  });

  it("cross-org organizer is denied", async () => {
    const foreign = await prisma.user.findUniqueOrThrow({
      where: { id: foreignUserId },
      include: { memberships: true },
    });
    actor.id = foreign.id;
    actor.email = foreign.email;
    actor.globalRole = GlobalRole.CUSTOMER;
    actor.memberships = foreign.memberships.map((m) => ({
      organizationId: m.organizationId,
      role: m.role,
      canRefund: m.canRefund,
      isActive: m.isActive,
    }));

    const { PATCH } = await import(
      "@/app/api/admin/orders/[orderNumber]/customer-email/route"
    );
    const res = await PATCH(
      new Request(`http://localhost/api/admin/orders/${paidOrderNumber}/customer-email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nope@example.com" }),
      }),
      { params: Promise.resolve({ orderNumber: paidOrderNumber }) }
    );
    expect(res.status).toBe(403);
  });

  it("invalid email is rejected", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/orders/[orderNumber]/customer-email/route"
    );
    const res = await PATCH(
      new Request(`http://localhost/api/admin/orders/${paidOrderNumber}/customer-email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      }),
      { params: Promise.resolve({ orderNumber: paidOrderNumber }) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("email correction does not change Stripe/payment data", async () => {
    const before = await prisma.payment.findUniqueOrThrow({ where: { id: stripePaymentId } });
    const beforeOrder = await prisma.order.findUniqueOrThrow({ where: { id: paidOrderId } });

    const { PATCH } = await import(
      "@/app/api/admin/orders/[orderNumber]/customer-email/route"
    );
    const res = await PATCH(
      new Request(`http://localhost/api/admin/orders/${paidOrderNumber}/customer-email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `stripe-safe-${suffix}@example.com` }),
      }),
      { params: Promise.resolve({ orderNumber: paidOrderNumber }) }
    );
    expect(res.status).toBe(200);

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: stripePaymentId } });
    const afterOrder = await prisma.order.findUniqueOrThrow({ where: { id: paidOrderId } });

    expect(after.providerPaymentId).toBe(before.providerPaymentId);
    expect(after.providerSessionId).toBe(before.providerSessionId);
    expect(after.amount).toBe(before.amount);
    expect(after.status).toBe(before.status);
    expect(after.provider).toBe(before.provider);
    expect(afterOrder.paymentStatus).toBe(beforeOrder.paymentStatus);
    expect(afterOrder.total).toBe(beforeOrder.total);
    expect(afterOrder.subtotal).toBe(beforeOrder.subtotal);
    expect(afterOrder.paidAt?.toISOString()).toBe(beforeOrder.paidAt?.toISOString());
  });

  it("paid order resend succeeds, audits, logs notifications, and does not duplicate tickets", async () => {
    const ticketsBefore = await prisma.ticket.count({ where: { orderId: paidOrderId } });
    const logsBefore = await prisma.notificationLog.count({ where: { orderId: paidOrderId } });

    const { POST } = await import(
      "@/app/api/admin/orders/[orderNumber]/resend-email/route"
    );
    const res = await POST(
      new Request(`http://localhost/api/admin/orders/${paidOrderNumber}/resend-email`, {
        method: "POST",
      }),
      { params: Promise.resolve({ orderNumber: paidOrderNumber }) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      email: string;
      ticketCount: number;
      audit: { action: string };
    };
    expect(body.ok).toBe(true);
    expect(body.ticketCount).toBe(ticketsBefore);
    expect(body.audit.action).toBe("ORDER_EMAIL_RESENT");

    const ticketsAfter = await prisma.ticket.count({ where: { orderId: paidOrderId } });
    expect(ticketsAfter).toBe(ticketsBefore);

    const logsAfter = await prisma.notificationLog.count({ where: { orderId: paidOrderId } });
    expect(logsAfter).toBe(logsBefore + 2);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: paidOrderId } });
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: paidOrderId, action: "ORDER_EMAIL_RESENT" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorId).toBe(actor.id);
    const meta = audit?.metadata as Record<string, unknown>;
    expect(meta.destinationEmail).toBe(order.customerEmail);
    expect(meta.orderNumber).toBe(paidOrderNumber);
    expect(meta).not.toHaveProperty("accessToken");
  });

  it("pending order resend is blocked", async () => {
    const { POST } = await import(
      "@/app/api/admin/orders/[orderNumber]/resend-email/route"
    );
    const res = await POST(
      new Request(`http://localhost/api/admin/orders/${pendingOrderNumber}/resend-email`, {
        method: "POST",
      }),
      { params: Promise.resolve({ orderNumber: pendingOrderNumber }) }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORDER_RESEND_BLOCKED");

    const pending = await prisma.order.findUniqueOrThrow({ where: { id: pendingOrderId } });
    expect(pending.paymentStatus).toBe(PaymentStatus.PENDING);
  });

  it("fully refunded order resend is blocked", async () => {
    const refundedNumber = `TKT-EMAIL-REF-${suffix}`;
    const refunded = await prisma.order.create({
      data: {
        orderNumber: refundedNumber,
        organizationId: orgAId,
        sellerOrganizationId: orgAId,
        eventId: eventAId,
        customerEmail: `buyer-ref-${suffix}@example.com`,
        customerFirstName: "Refunded",
        customerLastName: "Buyer",
        subtotal: 20000,
        total: 20000,
        paymentStatus: PaymentStatus.REFUNDED,
        orderStatus: "REFUNDED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId: ticketTypeAId,
            quantity: 1,
            unitPrice: 20000,
            total: 20000,
            name: "Standard",
          },
        },
      },
      include: { items: true },
    });
    orderIds.push(refunded.id);

    const token = generateSecureToken();
    const t = await prisma.ticket.create({
      data: {
        publicId: generatePublicTicketId(),
        tokenHash: hashTicketToken(token),
        tokenCipher: encryptTicketToken(token),
        orderId: refunded.id,
        orderItemId: refunded.items[0]!.id,
        eventId: eventAId,
        ticketTypeId: ticketTypeAId,
        holderName: "Refunded Buyer",
        holderEmail: `buyer-ref-${suffix}@example.com`,
        status: TicketStatus.REFUNDED,
      },
    });
    ticketIds.push(t.id);

    const { POST } = await import(
      "@/app/api/admin/orders/[orderNumber]/resend-email/route"
    );
    const res = await POST(
      new Request(`http://localhost/api/admin/orders/${refundedNumber}/resend-email`, {
        method: "POST",
      }),
      { params: Promise.resolve({ orderNumber: refundedNumber }) }
    );
    expect(res.status).toBe(409);
  });
});
