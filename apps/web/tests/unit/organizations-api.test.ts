import { describe, expect, it, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
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

describe("SUPER_ADMIN no-org settings CTA", () => {
  it("settings page shows prominent Opprett organisasjon CTA when no org", () => {
    const settingsSrc = readFileSync(
      path.resolve(__dirname, "../../src/app/admin/settings/page.tsx"),
      "utf8"
    );
    expect(settingsSrc).toContain("NoOrganizationPanel");
    expect(settingsSrc).toContain("SelectOrganizationPrompt");
    expect(settingsSrc).toContain("isSuperAdmin(user)");

    const panelSrc = readFileSync(
      path.resolve(__dirname, "../../src/components/admin/no-organization-panel.tsx"),
      "utf8"
    );
    expect(panelSrc).toContain("Opprett organisasjon");
    expect(panelSrc).toContain('href={createHref}');
    expect(panelSrc).toContain('"/admin/platform/organizations/new"');
    expect(panelSrc).toContain('data-testid="create-organization-cta"');
    expect(panelSrc).toContain("text-base font-semibold");
  });

  it("platform org routes exist for list, create, and edit", () => {
    const list = path.resolve(
      __dirname,
      "../../src/app/admin/platform/organizations/page.tsx"
    );
    const create = path.resolve(
      __dirname,
      "../../src/app/admin/platform/organizations/new/page.tsx"
    );
    const edit = path.resolve(
      __dirname,
      "../../src/app/admin/platform/organizations/[id]/page.tsx"
    );
    expect(readFileSync(list, "utf8")).toContain("Opprett organisasjon");
    expect(readFileSync(list, "utf8")).toContain("Rediger");
    expect(readFileSync(create, "utf8")).toContain("CreateOrganizationForm");
    expect(readFileSync(edit, "utf8")).toContain("EditOrganizationForm");
  });

  it("create form posts to existing API and full-navigates to settings", () => {
    const formSrc = readFileSync(
      path.resolve(__dirname, "../../src/components/admin/create-organization-form.tsx"),
      "utf8"
    );
    expect(formSrc).toContain('fetch("/api/admin/organizations"');
    expect(formSrc).toContain('method: "POST"');
    expect(formSrc).toContain('window.location.assign("/admin/settings")');
    expect(formSrc).toContain("customerServicePhone");
    expect(formSrc).toContain("contactEmail");
    expect(formSrc).toContain("refundPolicyText");
    expect(formSrc).toContain("website");
  });
});

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

  function validPayload(extra: Record<string, unknown> = {}) {
    return {
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
      website: `https://org-${suffix}.example.com`,
      vatRegistrationStatus: "REGISTERED" as const,
      refundPolicyText: "Full refusjon inntil 14 dager før arrangement.",
      ...extra,
    };
  }

  it("SUPER_ADMIN creates org, ORGANIZER_ADMIN membership, and audit log", async () => {
    const { POST } = await import("@/app/api/admin/organizations/route");
    const { requireSuperAdmin } = await import("@/lib/admin/org-access");

    const payload = validPayload();

    const res = await POST(
      new Request("http://localhost/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(requireSuperAdmin).toHaveBeenCalled();
    expect(res.status).toBe(201);
    const org = (await res.json()) as {
      id: string;
      name: string;
      slug: string;
      website: string | null;
    };
    createdOrgIds.push(org.id);

    expect(org.name).toBe(payload.displayName);
    expect(org.website).toBe(payload.website);
    expect(["titan-events", "shot-spot", "bloms", "noir", "festival-as", "xo"]).not.toContain(
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
    expect(stored.customerServicePhone).toBe(payload.customerServicePhone);
    expect(stored.contactEmail).toBe(payload.contactEmail);
    expect(stored.vatRegistrationStatus).toBe("REGISTERED");
    expect(stored.refundPolicyText).toBe(payload.refundPolicyText);
    expect(stored.isActive).toBe(true);

    // Created org is active and listed for SUPER_ADMIN platform management
    expect(
      await prisma.organization.findFirst({ where: { id: org.id, isActive: true } })
    ).toBeTruthy();

    const allOrgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    expect(allOrgs.some((o) => o.id === org.id)).toBe(true);

    const teamMembers = await prisma.organizationMember.findMany({
      where: { organizationId: org.id, isActive: true },
    });
    expect(teamMembers.some((m) => m.userId === superAdminUser.id)).toBe(true);
  });

  it("PATCH toggles isActive for SUPER_ADMIN", async () => {
    const { POST, PATCH } = await import("@/app/api/admin/organizations/route");
    const createRes = await POST(
      new Request("http://localhost/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validPayload({
            name: `Toggle Org ${suffix}`,
            displayName: `Toggle Org ${suffix}`,
            legalName: `Toggle Org AS ${suffix}`,
            organizationNumber: "888777666",
            customerServiceEmail: `toggle-${suffix}@example.com`,
            contactEmail: `toggle-c-${suffix}@example.com`,
            website: undefined,
          })
        ),
      })
    );
    expect(createRes.status).toBe(201);
    const org = (await createRes.json()) as { id: string };
    createdOrgIds.push(org.id);

    const patchRes = await PATCH(
      new Request("http://localhost/api/admin/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.id, isActive: false }),
      })
    );
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as { isActive: boolean };
    expect(updated.isActive).toBe(false);

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(stored.isActive).toBe(false);
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
        body: JSON.stringify(validPayload({ name: "Should Fail" })),
      })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("does not seed Titan Events / XO / Shot Spot demo orgs", async () => {
    const demoSlugs = ["titan-events", "shot-spot", "xo", "xo-drammen"];
    const { POST } = await import("@/app/api/admin/organizations/route");
    const res = await POST(
      new Request("http://localhost/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          validPayload({
            name: `No Demo ${suffix}`,
            displayName: `No Demo ${suffix}`,
            legalName: `No Demo AS ${suffix}`,
            organizationNumber: "777666555",
            customerServiceEmail: `nodemo-${suffix}@example.com`,
            contactEmail: `nodemo-c-${suffix}@example.com`,
            website: undefined,
          })
        ),
      })
    );
    expect(res.status).toBe(201);
    const org = (await res.json()) as { id: string; slug: string };
    createdOrgIds.push(org.id);
    expect(demoSlugs).not.toContain(org.slug);
  });
});
