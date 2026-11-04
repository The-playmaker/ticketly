import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { GlobalRole, OrgRole } from "@prisma/client";
import { AppError } from "@/lib/api-error";

const actor = {
  id: "u-org",
  email: "org-admin@test.local",
  globalRole: GlobalRole.CUSTOMER as GlobalRole,
  isActive: true,
  memberships: [
    {
      organizationId: "org-a",
      role: OrgRole.ORGANIZER_ADMIN,
      canRefund: true,
      isActive: true,
    },
  ],
};

vi.mock("@/lib/admin/org-access", () => ({
  requireSuperAdmin: vi.fn(async () => {
    if (actor.globalRole !== GlobalRole.SUPER_ADMIN) {
      throw new AppError("FORBIDDEN", "Kun SUPER_ADMIN", 403);
    }
    return { user: actor, session: { user: actor } };
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    webhookEvent: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
  },
}));

vi.mock("@/lib/payments", () => ({
  nexiConfigHealth: () => ({
    status: "operational",
    environment: "test",
    message: "ok",
  }),
  resolvePaymentProviderType: () => "NEXI",
}));

vi.mock("@/services/payment-service", () => ({
  PaymentService: { replayWebhookEvent: vi.fn() },
}));

const src = (rel: string) =>
  readFileSync(path.resolve(__dirname, "../../src", rel), "utf8");

describe("admin platform routes require SUPER_ADMIN", () => {
  beforeEach(() => {
    actor.globalRole = GlobalRole.CUSTOMER;
  });

  it("webhooks and system/health source gates use requireSuperAdmin", () => {
    const webhooks = src("app/api/admin/webhooks/route.ts");
    expect(webhooks).toContain("requireSuperAdmin");
    expect(webhooks).not.toMatch(/export async function GET[\s\S]*?auth\(\)/);

    const health = src("app/api/admin/system/health/route.ts");
    expect(health).toContain("requireSuperAdmin");
    expect(health).not.toMatch(/session\.user\)\s*\{/);
  });

  it("GET /api/admin/webhooks rejects non-SUPER_ADMIN with 403", async () => {
    const { GET } = await import("@/app/api/admin/webhooks/route");
    const res = await GET(new Request("http://localhost/api/admin/webhooks"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("GET /api/admin/system/health rejects non-SUPER_ADMIN with 403", async () => {
    const { GET } = await import("@/app/api/admin/system/health/route");
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("GET /api/admin/webhooks allows SUPER_ADMIN", async () => {
    actor.globalRole = GlobalRole.SUPER_ADMIN;
    const { GET } = await import("@/app/api/admin/webhooks/route");
    const res = await GET(new Request("http://localhost/api/admin/webhooks"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
  });
});
