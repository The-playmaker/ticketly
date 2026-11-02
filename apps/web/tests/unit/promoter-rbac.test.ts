import { describe, expect, it } from "vitest";
import { GlobalRole, OrgRole } from "@prisma/client";
import { canManageEvents, isSuperAdmin, type AuthUser } from "@/lib/auth/rbac";

function user(opts: {
  globalRole?: GlobalRole;
  memberships?: AuthUser["memberships"];
}): AuthUser {
  return {
    id: "u1",
    email: "t@example.com",
    globalRole: opts.globalRole ?? GlobalRole.CUSTOMER,
    isActive: true,
    memberships: opts.memberships ?? [],
  };
}

describe("promoter admin RBAC", () => {
  const orgA = "org_a";
  const orgB = "org_b";

  it("ORGANIZER_ADMIN / EVENT_MANAGER can manage own org promoters", () => {
    const admin = user({
      memberships: [
        { organizationId: orgA, role: OrgRole.ORGANIZER_ADMIN, canRefund: true, isActive: true },
      ],
    });
    const manager = user({
      memberships: [
        { organizationId: orgA, role: OrgRole.EVENT_MANAGER, canRefund: false, isActive: true },
      ],
    });
    expect(canManageEvents(admin, orgA)).toBe(true);
    expect(canManageEvents(manager, orgA)).toBe(true);
  });

  it("denies other-org and door staff", () => {
    const admin = user({
      memberships: [
        { organizationId: orgA, role: OrgRole.ORGANIZER_ADMIN, canRefund: true, isActive: true },
      ],
    });
    const door = user({
      memberships: [
        { organizationId: orgA, role: OrgRole.DOOR_STAFF, canRefund: false, isActive: true },
      ],
    });
    expect(canManageEvents(admin, orgB)).toBe(false);
    expect(canManageEvents(door, orgA)).toBe(false);
  });

  it("SUPER_ADMIN can manage any org promoters", () => {
    const sa = user({ globalRole: GlobalRole.SUPER_ADMIN, memberships: [] });
    expect(isSuperAdmin(sa)).toBe(true);
    expect(canManageEvents(sa, orgA)).toBe(true);
    expect(canManageEvents(sa, orgB)).toBe(true);
  });
});
