import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

describe("admin cache tags", () => {
  it("exports stable tag names and TTLs in safe ranges", async () => {
    const { CACHE_TAGS, CACHE_TTL } = await import("@/lib/cache/tags");

    expect(CACHE_TAGS.orgs).toBe("admin:orgs");
    expect(CACHE_TAGS.dashboard).toBe("admin:dashboard");
    expect(CACHE_TAGS.publicEvents).toBe("public:events");
    expect(CACHE_TAGS.dashboardOrg(null)).toBe("admin:dashboard:global");
    expect(CACHE_TAGS.dashboardOrg("org_1")).toBe("admin:dashboard:org_1");
    expect(CACHE_TAGS.adminEventsOrg("org_1")).toBe("admin:events:org_1");

    expect(CACHE_TTL.orgs).toBeGreaterThanOrEqual(15);
    expect(CACHE_TTL.orgs).toBeLessThanOrEqual(60);
    expect(CACHE_TTL.dashboard).toBeGreaterThanOrEqual(15);
    expect(CACHE_TTL.dashboard).toBeLessThanOrEqual(60);
    expect(CACHE_TTL.adminEvents).toBeGreaterThanOrEqual(15);
    expect(CACHE_TTL.adminEvents).toBeLessThanOrEqual(60);
    expect(CACHE_TTL.publicEvents).toBeGreaterThanOrEqual(15);
    expect(CACHE_TTL.publicEvents).toBeLessThanOrEqual(60);
  });

  it("revalidateAdminDataCaches busts shared + org-scoped tags", async () => {
    const { revalidateTag } = await import("next/cache");
    const { CACHE_TAGS, revalidateAdminDataCaches } = await import("@/lib/cache/tags");

    revalidateAdminDataCaches("org_abc");

    expect(revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.orgs, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.dashboard, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.adminEvents, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.publicEvents, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.dashboardOrg("org_abc"), {
      expire: 0,
    });
    expect(revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.adminEventsOrg("org_abc"), {
      expire: 0,
    });
    expect(revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.dashboardOrg(null), { expire: 0 });
  });

  it("event mutation routes call revalidateAdminDataCaches", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "src/app/api/admin");
    const files = [
      "events/route.ts",
      "events/[id]/route.ts",
      "events/[id]/actions/route.ts",
      "organizations/route.ts",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src).toContain("revalidateAdminDataCaches");
    }
  });
});
