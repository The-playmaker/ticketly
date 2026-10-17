import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { GlobalRole, OrgRole } from "@prisma/client";
import {
  canManageEvents,
  canManageOrganization,
  canAccessAdmin,
  isSuperAdmin,
  type AuthUser,
} from "@/lib/auth/rbac";
import {
  canAccessAssignedEvent,
  filterEventsByAssignment,
  isDoorStaffOnly,
} from "@/lib/auth/event-access";
import { parseAdminOrgCookie, organizationIdWhere } from "@/lib/admin/org-context-utils";
import { ADMIN_ORG_COOKIE, ADMIN_ORG_GLOBAL } from "@/lib/admin/org-context-constants";

/** Mirrors resolveOrgIdParam auth rules without importing NextAuth-bound modules. */
function assertOrgParamAllowed(
  user: AuthUser,
  membershipOrgId: string | null,
  explicitOrgId: string | null
): { ok: true; orgId: string | null } | { ok: false; code: string } {
  if (isSuperAdmin(user)) {
    return { ok: true, orgId: explicitOrgId ?? null };
  }
  if (!membershipOrgId) return { ok: false, code: "FORBIDDEN" };
  if (explicitOrgId && explicitOrgId !== membershipOrgId) {
    return { ok: false, code: "FORBIDDEN" };
  }
  return { ok: true, orgId: membershipOrgId };
}

const src = (rel: string) =>
  readFileSync(path.resolve(__dirname, "../../src", rel), "utf8");

const superAdmin: AuthUser = {
  id: "sa",
  email: "sa@example.com",
  globalRole: GlobalRole.SUPER_ADMIN,
  isActive: true,
  memberships: [],
};

const organizerA: AuthUser = {
  id: "oa",
  email: "oa@example.com",
  globalRole: GlobalRole.CUSTOMER,
  isActive: true,
  memberships: [
    { organizationId: "org-a", role: OrgRole.ORGANIZER_ADMIN, canRefund: true, isActive: true },
  ],
};

const doorStaff: AuthUser = {
  id: "door",
  email: "door@example.com",
  globalRole: GlobalRole.CUSTOMER,
  isActive: true,
  memberships: [
    { organizationId: "org-a", role: OrgRole.DOOR_STAFF, canRefund: false, isActive: true },
  ],
};

const orgs = [
  { id: "org-a", name: "Alpha", slug: "alpha", isActive: true },
  { id: "org-b", name: "Beta", slug: "beta", isActive: true },
];

describe("SUPER_ADMIN platform RBAC (no membership required)", () => {
  it("can access admin and manage any org/event without memberships", () => {
    expect(isSuperAdmin(superAdmin)).toBe(true);
    expect(canAccessAdmin(superAdmin)).toBe(true);
    expect(canManageOrganization(superAdmin, "org-a")).toBe(true);
    expect(canManageOrganization(superAdmin, "org-b")).toBe(true);
    expect(canManageEvents(superAdmin, "org-a")).toBe(true);
    expect(canManageEvents(superAdmin, "org-b")).toBe(true);
    expect(isDoorStaffOnly(superAdmin)).toBe(false);
  });

  it("sees all events across orgs via assignment filter bypass", () => {
    const events = [
      { id: "e1", organizationId: "org-a" },
      { id: "e2", organizationId: "org-b" },
    ];
    expect(filterEventsByAssignment(superAdmin, events)).toHaveLength(2);
    expect(canAccessAssignedEvent(superAdmin, events[1]!)).toBe(true);
  });
});

describe("Non-SUPER_ADMIN isolation preserved", () => {
  it("organizer admin cannot manage other orgs", () => {
    expect(canManageOrganization(organizerA, "org-a")).toBe(true);
    expect(canManageOrganization(organizerA, "org-b")).toBe(false);
    expect(canManageEvents(organizerA, "org-b")).toBe(false);
  });

  it("door staff cannot edit events/orgs", () => {
    expect(canManageEvents(doorStaff, "org-a")).toBe(false);
    expect(canManageOrganization(doorStaff, "org-a")).toBe(false);
    expect(isDoorStaffOnly(doorStaff)).toBe(true);
    const events = [
      { id: "e1", organizationId: "org-a" },
      { id: "e2", organizationId: "org-a" },
    ];
    expect(
      filterEventsByAssignment({ ...doorStaff, eventAssignments: [{ eventId: "e1" }] }, events).map(
        (e) => e.id
      )
    ).toEqual(["e1"]);
  });
});

describe("Organization context selector", () => {
  it("defaults to global when cookie missing or __all__", () => {
    expect(parseAdminOrgCookie(null, orgs)).toEqual({
      mode: "global",
      organizationId: null,
    });
    expect(parseAdminOrgCookie(ADMIN_ORG_GLOBAL, orgs)).toEqual({
      mode: "global",
      organizationId: null,
    });
  });

  it("selects a concrete org when cookie matches", () => {
    expect(parseAdminOrgCookie("org-b", orgs)).toEqual({
      mode: "organization",
      organizationId: "org-b",
    });
  });

  it("falls back to global for unknown cookie org id", () => {
    expect(parseAdminOrgCookie("missing", orgs)).toEqual({
      mode: "global",
      organizationId: null,
    });
  });

  it("organizationIdWhere omits filter in global mode", () => {
    expect(organizationIdWhere(null)).toEqual({});
    expect(organizationIdWhere(undefined)).toEqual({});
    expect(organizationIdWhere("org-a")).toEqual({ organizationId: "org-a" });
  });

  it("cookie constant is stable for API + client", () => {
    expect(ADMIN_ORG_COOKIE).toBe("ticketly_admin_org");
    expect(ADMIN_ORG_GLOBAL).toBe("__all__");
  });
});

describe("Admin UI wiring for SUPER_ADMIN global access", () => {
  it("admin layout embeds org context switcher for platform admin", () => {
    const layout = src("app/admin/layout.tsx");
    expect(layout).toContain("OrgContextSwitcher");
    expect(layout).toContain("resolveOrgScopeForUser");
    expect(layout).not.toContain('slug: "titan-events"');
  });

  it("dashboard and events no longer hardcode titan-events", () => {
    expect(src("app/admin/page.tsx")).not.toContain("titan-events");
    expect(src("app/admin/events/page.tsx")).not.toContain("titan-events");
    expect(src("app/admin/page.tsx")).toContain("resolveOrgScopeForUser");
    expect(src("app/admin/events/page.tsx")).toContain("organization.name");
  });

  it("order detail allows platform-wide lookup (no impossible id gate)", () => {
    const orderDetail = src("app/admin/orders/[orderNumber]/page.tsx");
    expect(orderDetail).not.toContain('id: "impossible"');
    expect(orderDetail).toContain("organizationIdWhere");
    expect(orderDetail).toContain("resolveOrgScopeForUser");
  });

  it("settings/team prompt to select org instead of hard membership dead-end", () => {
    expect(src("app/admin/settings/page.tsx")).toContain("SelectOrganizationPrompt");
    expect(src("app/admin/settings/team/page.tsx")).toContain("SelectOrganizationPrompt");
    expect(src("components/admin/no-organization-panel.tsx")).toContain("Opprett organisasjon");
  });

  it("org-context API and requireEventAccess bypass exist", () => {
    expect(src("app/api/admin/org-context/route.ts")).toContain("ADMIN_ORG_COOKIE");
    const access = src("lib/admin/org-access.ts");
    expect(access).toContain("resolveOrgScopeForUser");
    expect(access).toContain("isSuperAdmin(user)");
    expect(access).toContain("requireEventAccess");
  });
});

describe("resolveOrgIdParam authorization rules", () => {
  it("rejects non-admin accessing foreign organizationId", () => {
    expect(assertOrgParamAllowed(organizerA, "org-a", "org-b")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("allows SUPER_ADMIN explicit organizationId without membership", () => {
    expect(assertOrgParamAllowed(superAdmin, null, "org-b")).toEqual({
      ok: true,
      orgId: "org-b",
    });
  });

  it("allows SUPER_ADMIN global (null) scope", () => {
    expect(assertOrgParamAllowed(superAdmin, null, null)).toEqual({
      ok: true,
      orgId: null,
    });
  });

  it("door staff cannot escalate via foreign org id", () => {
    expect(assertOrgParamAllowed(doorStaff, "org-a", "org-b")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(canManageOrganization(doorStaff, "org-a")).toBe(false);
    expect(canManageEvents(doorStaff, "org-a")).toBe(false);
  });
});
