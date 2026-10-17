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

const superAdminUser = {
  id: "placeholder",
  email: "super-ownership@test.local",
  globalRole: GlobalRole.SUPER_ADMIN,
  isActive: true,
  memberships: [] as {
    organizationId: string;
    role: OrgRole;
    canRefund: boolean;
    isActive: boolean;
  }[],
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
  resolveOrgIdForUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Event ownership UI wiring", () => {
  it("settings page shows ownership form only for SUPER_ADMIN", () => {
    const settingsSrc = readFileSync(
      path.resolve(__dirname, "../../src/app/admin/events/[id]/settings/page.tsx"),
      "utf8"
    );
    expect(settingsSrc).toContain("EventOwnershipForm");
    expect(settingsSrc).toContain("isSuperAdmin(user)");
    expect(settingsSrc).toContain("where: { isActive: true }");
  });

  it("ownership form labels and organizer confirmation match requirements", () => {
    const formSrc = readFileSync(
      path.resolve(__dirname, "../../src/components/admin/event-ownership-form.tsx"),
      "utf8"
    );
    expect(formSrc).toContain("Organisator:");
    expect(formSrc).toContain("Juridisk selger:");
    expect(formSrc).toContain(
      "Dette flytter arrangementet til en annen organisasjon. Eksisterende billetter og ordre beholdes."
    );
    expect(formSrc).toContain("/api/admin/events/${eventId}/ownership");
    expect(formSrc).toContain("activeOrgs");
  });

  it("ownership API is SUPER_ADMIN only and revalidates admin paths", () => {
    const routeSrc = readFileSync(
      path.resolve(__dirname, "../../src/app/api/admin/events/[id]/ownership/route.ts"),
      "utf8"
    );
    expect(routeSrc).toContain("requireSuperAdmin");
    expect(routeSrc).toContain('revalidatePath("/admin/events")');
    expect(routeSrc).toContain("updateOwnership");

    const serviceSrc = readFileSync(
      path.resolve(__dirname, "../../src/services/event-service.ts"),
      "utf8"
    );
    expect(serviceSrc).toContain("EVENT_ORGANIZATION_CHANGED");
    expect(serviceSrc).toContain("oldOrganizationId");
    expect(serviceSrc).toContain("newSellerOrganizationId");
  });
});

describe.runIf(runDb)("PATCH /api/admin/events/[id]/ownership", () => {
  const suffix = Date.now().toString(36);
  const orgIds: string[] = [];
  const eventIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const ticketIds: string[] = [];
  const ticketTypeIds: string[] = [];

  let orgAId = "";
  let orgBId = "";
  let inactiveOrgId = "";
  let eventId = "";
  let ticketTypeId = "";
  let orderId = "";
  let ticketId = "";
  let publicTicketId = "";
  let eventSlug = "";

  beforeAll(async () => {
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET ?? "test-secret-at-least-32-chars-long!!";

    const superAdmin = await prisma.user.create({
      data: {
        email: `super-own-${suffix}@test.local`,
        globalRole: GlobalRole.SUPER_ADMIN,
        isActive: true,
        name: "Super Ownership",
      },
    });
    superAdminUser.id = superAdmin.id;
    superAdminUser.email = superAdmin.email;
    userIds.push(superAdmin.id);

    const orgA = await prisma.organization.create({
      data: {
        name: `Own Org A ${suffix}`,
        slug: `own-org-a-${suffix}`,
        legalName: `Own Org A AS ${suffix}`,
        organizationNumber: "111222333",
        isActive: true,
      },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: `Own Org B ${suffix}`,
        slug: `own-org-b-${suffix}`,
        legalName: `Own Org B AS ${suffix}`,
        organizationNumber: "444555666",
        isActive: true,
      },
    });
    const inactive = await prisma.organization.create({
      data: {
        name: `Own Org Inactive ${suffix}`,
        slug: `own-org-inactive-${suffix}`,
        legalName: `Own Org Inactive AS ${suffix}`,
        organizationNumber: "777888999",
        isActive: false,
      },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;
    inactiveOrgId = inactive.id;
    orgIds.push(orgA.id, orgB.id, inactive.id);

    eventSlug = `own-event-${suffix}`;
    const event = await prisma.event.create({
      data: {
        organizationId: orgAId,
        sellerOrganizationId: orgAId,
        name: `Ownership Event ${suffix}`,
        slug: eventSlug,
        capacity: 100,
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        status: EventStatus.PUBLISHED,
        visibility: "PUBLIC",
      },
    });
    eventId = event.id;
    eventIds.push(event.id);

    const tt = await prisma.ticketType.create({
      data: {
        eventId,
        name: "Standard",
        price: 25000,
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
    ticketTypeId = tt.id;
    ticketTypeIds.push(tt.id);

    const order = await prisma.order.create({
      data: {
        orderNumber: `TKT-OWN-${suffix}`,
        organizationId: orgAId,
        sellerOrganizationId: orgAId,
        eventId,
        customerEmail: `buyer-${suffix}@example.com`,
        customerFirstName: "Buyer",
        customerLastName: "Test",
        subtotal: 25000,
        serviceFee: 0,
        tax: 0,
        discount: 0,
        total: 25000,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: "CONFIRMED",
        paidAt: new Date(),
        items: {
          create: {
            ticketTypeId,
            quantity: 1,
            unitPrice: 25000,
            serviceFee: 0,
            tax: 0,
            total: 25000,
            name: "Standard",
          },
        },
      },
      include: { items: true },
    });
    orderId = order.id;
    orderIds.push(order.id);

    const token = generateSecureToken();
    publicTicketId = generatePublicTicketId();
    const ticket = await prisma.ticket.create({
      data: {
        publicId: publicTicketId,
        tokenHash: hashTicketToken(token),
        tokenCipher: encryptTicketToken(token),
        secureToken: null,
        orderId: order.id,
        orderItemId: order.items[0]!.id,
        eventId,
        ticketTypeId,
        holderName: "Buyer Test",
        holderEmail: `buyer-${suffix}@example.com`,
        status: TicketStatus.VALID,
      },
    });
    ticketId = ticket.id;
    ticketIds.push(ticket.id);
  });

  afterAll(async () => {
    if (ticketIds.length) {
      await prisma.checkIn.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    }
    if (orderIds.length) {
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (ticketTypeIds.length) {
      await prisma.ticketType.deleteMany({ where: { id: { in: ticketTypeIds } } });
    }
    if (eventIds.length) {
      await prisma.auditLog.deleteMany({
        where: { entityType: "Event", entityId: { in: eventIds } },
      });
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

  beforeEach(() => {
    superAdminUser.globalRole = GlobalRole.SUPER_ADMIN;
    vi.clearAllMocks();
  });

  it("SUPER_ADMIN can move event across orgs and preserve tickets/orders/slug", async () => {
    const { PATCH } = await import("@/app/api/admin/events/[id]/ownership/route");
    const { revalidatePath } = await import("next/cache");

    const res = await PATCH(
      new Request(`http://localhost/api/admin/events/${eventId}/ownership`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgBId,
          sellerOrganizationId: orgAId,
        }),
      }),
      { params: Promise.resolve({ id: eventId }) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: { id: string; organizationId: string; sellerOrganizationId: string; slug: string };
    };
    expect(body.event.id).toBe(eventId);
    expect(body.event.organizationId).toBe(orgBId);
    expect(body.event.sellerOrganizationId).toBe(orgAId);
    expect(body.event.slug).toBe(eventSlug);

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(stored.organizationId).toBe(orgBId);
    expect(stored.sellerOrganizationId).toBe(orgAId);
    expect(stored.slug).toBe(eventSlug);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.organizationId).toBe(orgAId);
    expect(order.sellerOrganizationId).toBe(orgAId);
    expect(order.orderNumber).toBe(`TKT-OWN-${suffix}`);

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.id).toBe(ticketId);
    expect(ticket.publicId).toBe(publicTicketId);
    expect(ticket.eventId).toBe(eventId);
    expect(ticket.orderId).toBe(orderId);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: eventId, action: "EVENT_ORGANIZATION_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorId).toBe(superAdminUser.id);
    const meta = audit?.metadata as Record<string, string>;
    expect(meta.oldOrganizationId).toBe(orgAId);
    expect(meta.newOrganizationId).toBe(orgBId);
    expect(meta.oldSellerOrganizationId).toBe(orgAId);
    expect(meta.newSellerOrganizationId).toBe(orgAId);

    expect(revalidatePath).toHaveBeenCalledWith("/admin/events");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/events/${eventId}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/events/${eventId}/settings`);
  });

  it("seller can change separately from organizer", async () => {
    const { PATCH } = await import("@/app/api/admin/events/[id]/ownership/route");

    const res = await PATCH(
      new Request(`http://localhost/api/admin/events/${eventId}/ownership`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgBId,
          sellerOrganizationId: orgBId,
        }),
      }),
      { params: Promise.resolve({ id: eventId }) }
    );

    expect(res.status).toBe(200);
    const stored = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(stored.organizationId).toBe(orgBId);
    expect(stored.sellerOrganizationId).toBe(orgBId);
    expect(stored.slug).toBe(eventSlug);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.organizationId).toBe(orgAId);
  });

  it("inactive org cannot be selected", async () => {
    const { PATCH } = await import("@/app/api/admin/events/[id]/ownership/route");

    const res = await PATCH(
      new Request(`http://localhost/api/admin/events/${eventId}/ownership`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: inactiveOrgId,
          sellerOrganizationId: orgBId,
        }),
      }),
      { params: Promise.resolve({ id: eventId }) }
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INACTIVE_ORGANIZATION");

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(stored.organizationId).toBe(orgBId);
  });

  it("organizer admin cannot call ownership API", async () => {
    const { requireSuperAdmin } = await import("@/lib/admin/org-access");
    vi.mocked(requireSuperAdmin).mockRejectedValueOnce(
      new AppError("FORBIDDEN", "Kun SUPER_ADMIN", 403)
    );

    const { PATCH } = await import("@/app/api/admin/events/[id]/ownership/route");
    const res = await PATCH(
      new Request(`http://localhost/api/admin/events/${eventId}/ownership`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgAId,
          sellerOrganizationId: orgAId,
        }),
      }),
      { params: Promise.resolve({ id: eventId }) }
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("event appears under new org filter after move", async () => {
    const underB = await prisma.event.findMany({
      where: { organizationId: orgBId, id: eventId },
    });
    expect(underB).toHaveLength(1);

    const underA = await prisma.event.findMany({
      where: { organizationId: orgAId, id: eventId },
    });
    expect(underA).toHaveLength(0);

    const bySlug = await prisma.event.findFirst({ where: { slug: eventSlug } });
    expect(bySlug?.id).toBe(eventId);
  });
});
