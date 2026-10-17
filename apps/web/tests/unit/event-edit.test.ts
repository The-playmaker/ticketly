import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { canManageEvents, canScanTickets, isSuperAdmin } from "@/lib/auth/rbac";
import { GlobalRole, OrgRole } from "@prisma/client";
import type { AuthUser } from "@/lib/auth/rbac";

describe("event edit RBAC", () => {
  const orgId = "org_a";

  const superAdmin: AuthUser = {
    id: "u1",
    email: "sa@test.local",
    globalRole: GlobalRole.SUPER_ADMIN,
    isActive: true,
    memberships: [],
  };

  const organizer: AuthUser = {
    id: "u2",
    email: "org@test.local",
    globalRole: GlobalRole.CUSTOMER,
    isActive: true,
    memberships: [
      { organizationId: orgId, role: OrgRole.ORGANIZER_ADMIN, canRefund: true, isActive: true },
    ],
  };

  const doorStaff: AuthUser = {
    id: "u3",
    email: "door@test.local",
    globalRole: GlobalRole.CUSTOMER,
    isActive: true,
    memberships: [
      { organizationId: orgId, role: OrgRole.DOOR_STAFF, canRefund: false, isActive: true },
    ],
  };

  const otherOrgAdmin: AuthUser = {
    id: "u4",
    email: "other@test.local",
    globalRole: GlobalRole.CUSTOMER,
    isActive: true,
    memberships: [
      {
        organizationId: "org_b",
        role: OrgRole.ORGANIZER_ADMIN,
        canRefund: true,
        isActive: true,
      },
    ],
  };

  it("SUPER_ADMIN can manage any org events", () => {
    expect(isSuperAdmin(superAdmin)).toBe(true);
    expect(canManageEvents(superAdmin, orgId)).toBe(true);
    expect(canManageEvents(superAdmin, "org_other")).toBe(true);
  });

  it("organizer admin can manage own org only", () => {
    expect(canManageEvents(organizer, orgId)).toBe(true);
    expect(canManageEvents(organizer, "org_b")).toBe(false);
    expect(canManageEvents(otherOrgAdmin, orgId)).toBe(false);
  });

  it("door staff can scan but cannot manage events / upload", () => {
    expect(canScanTickets(doorStaff, orgId)).toBe(true);
    expect(canManageEvents(doorStaff, orgId)).toBe(false);
  });
});

describe("event edit API + form preserve financial ownership", () => {
  it("PATCH event route does not rewrite Order financial ownership fields", () => {
    const route = readFileSync(
      path.resolve(__dirname, "../../src/app/api/admin/events/[id]/route.ts"),
      "utf8"
    );
    expect(route).toContain("requireEventManageAccess");
    expect(route).not.toContain("order.update");
    expect(route).not.toContain("sellerOrganizationId");
    expect(route).toContain("ticketTypes");
    expect(route).toContain("INVALID_COVER_URL");
  });

  it("ownership remains SUPER_ADMIN-only via existing ownership form/API", () => {
    const form = readFileSync(
      path.resolve(__dirname, "../../src/components/admin/edit-event-form.tsx"),
      "utf8"
    );
    expect(form).toContain("EventOwnershipForm");
    expect(form).toContain("isPlatformAdmin");
    expect(form).toContain("CoverImageUploader");
    expect(form).toContain("Lagre arrangement");
  });

  it("tickets/orders unchanged note is surfaced on edit page", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../../src/app/admin/events/[id]/edit/page.tsx"),
      "utf8"
    );
    expect(page).toContain("ordrer, betalinger, billetter");
  });
});
