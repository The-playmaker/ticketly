import { describe, expect, it, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { PrismaClient, GlobalRole, OrgRole } from "@prisma/client";
import { AppError } from "@/lib/api-error";

const prisma = new PrismaClient();
const runDb = Boolean(process.env.DATABASE_URL);

const superAdminUser = {
  id: "placeholder",
  email: "super-org-test@test.local",
  globalRole: GlobalRole.SUPER_ADMIN,
  isActive: true,
  memberships: [] as {
    organizationId: string;
    role: OrgRole;
    canRefund: boolean;
    isActive: boolean;
  }[],
};

const organizerUser = {
  id: "placeholder-org",
  email: "organizer-org-test@test.local",
  globalRole: GlobalRole.CUSTOMER,
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
  resolveOrgIdForUser: vi.fn(),
}));

describe.runIf(runDb)("POST /api/admin/organizations", () => {
  const suffix = Date.now().toString(36);
  const createdOrgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const superAdmin = await prisma.user.create({
      data: {
        email: `super-org-${suffix}@test.local`,
        globalRole: GlobalRole.SUPER_ADMIN,
        isActive: true,
        name: "Super Org Tester",
      },
    });
    superAdminUser.id = superAdmin.id;
    superAdminUser.email = superAdmin.email;
    userIds.push(superAdmin.id);

    const organizer = await prisma.user.create({
      data: {
        email: `org-user-${suffix}@test.local`,
        globalRole: GlobalRole.CUSTOMER,
        isActive: true,
        name: "Organizer",
      },
    });
    organizerUser.id = organizer.id;
    organizerUser.email = organizer.email;
    userIds.push(organizer.id);
  });

  afterAll(async () => {
    if (createdOrgIds.length) {
      await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: createdOrgIds } },
      });
      await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    superAdminUser.globalRole = GlobalRole.SUPER_ADMIN;
    vi.clearAllMocks();
  });

  it("SUPER_ADMIN creates org, ORGANIZER_ADMIN membership, and audit log", async () => {
    const { POST } = await import("@/app/api/admin/organizations/route");
    const { requireSuperAdmin } = await import("@/lib/admin/org-access");

    const payload = {
      name: `Real Org ${suffix}`,
      displayName: `Real Org ${suffix}`,
      legalName: `Real Org AS ${suffix}`,
      organizationNumber: "999888777",
      legalAddress: "Storgata 1",
      legalPostalCode: "0182",
      legalCity: "Oslo",
      legalCountry: "NO",
      customerServiceEmail: `support-${suffix}@example.com`,
      customerServicePhone: "+47 22 00 00 00",
      contactEmail: `contact-${suffix}@example.com`,
      vatRegistrationStatus: "REGISTERED" as const,
      refundPolicyText: "Full refusjon inntil 14 dager før arrangement.",
    };

    const res = await POST(
      new Request("http://localhost/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(requireSuperAdmin).toHaveBeenCalled();
    expect(res.status).toBe(201);
    const org = (await res.json()) as { id: string; name: string; slug: string };
    createdOrgIds.push(org.id);

    expect(org.name).toBe(payload.displayName);
    // Must not collide with demo cleanup seed slugs
    expect(["titan-events", "shot-spot", "bloms", "noir", "festival-as"]).not.toContain(
      org.slug
    );

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: superAdminUser.id,
        },
      },
    });
    expect(membership?.role).toBe(OrgRole.ORGANIZER_ADMIN);
    expect(membership?.isActive).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "ORG_CREATED" },
    });
    expect(audit?.actorId).toBe(superAdminUser.id);
    expect(audit?.entityId).toBe(org.id);

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(stored.legalName).toBe(payload.legalName);
    expect(stored.organizationNumber).toBe(payload.organizationNumber);
    expect(stored.legalAddress).toBe(payload.legalAddress);
    expect(stored.customerServiceEmail).toBe(payload.customerServiceEmail);
    expect(stored.contactEmail).toBe(payload.contactEmail);
    expect(stored.vatRegistrationStatus).toBe("REGISTERED");
    expect(stored.refundPolicyText).toBe(payload.refundPolicyText);

    // Settings/team resolve the first active org for SUPER_ADMIN — seller fields must be present
    const settingsOrg = await prisma.organization.findFirst({
      where: { isActive: true, id: org.id },
    });
    expect(settingsOrg?.legalName).toBeTruthy();
    expect(settingsOrg?.organizationNumber).toBeTruthy();

    // Team page lists members for the resolved org
    const teamMembers = await prisma.organizationMember.findMany({
      where: { organizationId: org.id, isActive: true },
    });
    expect(teamMembers.some((m) => m.userId === superAdminUser.id)).toBe(true);
  });

  it("non-SUPER_ADMIN cannot create org (403)", async () => {
    const { requireSuperAdmin } = await import("@/lib/admin/org-access");
    vi.mocked(requireSuperAdmin).mockRejectedValueOnce(
      new AppError("FORBIDDEN", "Kun SUPER_ADMIN", 403)
    );

    const { POST } = await import("@/app/api/admin/organizations/route");
    const res = await POST(
      new Request("http://localhost/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Should Fail",
          legalName: "Should Fail AS",
          organizationNumber: "111111111",
          legalAddress: "Nowhere 1",
          legalPostalCode: "0001",
          legalCity: "Oslo",
          legalCountry: "NO",
          customerServiceEmail: "fail@example.com",
          refundPolicyText: "n/a",
        }),
      })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
