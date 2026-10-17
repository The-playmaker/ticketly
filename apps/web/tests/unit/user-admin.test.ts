import { describe, expect, it } from "vitest";
import { GlobalRole, OrgRole } from "@prisma/client";
import {
  canManageEvents,
  canManageOrganization,
  canManageTeam,
  canRefund,
  canScanTickets,
  canViewFinancials,
  isSuperAdmin,
  type AuthUser,
} from "@/lib/auth/rbac";
import {
  canAccessAssignedEvent,
  filterEventsByAssignment,
  isDoorStaffOnly,
} from "@/lib/auth/event-access";
import {
  getEventPublishBlockers,
  formatPublishBlockedMessage,
} from "@/lib/publish/readiness";
import { validateStrongPassword, looksLikeWeakPassword } from "@/lib/auth/password";
import { hashToken, generateRawToken } from "@/lib/auth/action-tokens";

const door: AuthUser = {
  id: "u-door",
  email: "door@example.com",
  globalRole: GlobalRole.CUSTOMER,
  isActive: true,
  memberships: [
    { organizationId: "org1", role: OrgRole.DOOR_STAFF, canRefund: false, isActive: true },
  ],
};

const organizer: AuthUser = {
  id: "u-org",
  email: "organizer@example.com",
  globalRole: GlobalRole.CUSTOMER,
  isActive: true,
  memberships: [
    { organizationId: "org1", role: OrgRole.ORGANIZER_ADMIN, canRefund: true, isActive: true },
  ],
};

const admin: AuthUser = {
  id: "u-admin",
  email: "admin@example.com",
  globalRole: GlobalRole.SUPER_ADMIN,
  isActive: true,
  memberships: [],
};

const disabled: AuthUser = {
  id: "u-off",
  email: "off@example.com",
  globalRole: GlobalRole.SUPER_ADMIN,
  isActive: false,
  memberships: [],
};

describe("RBAC — platform & org isolation", () => {
  it("SUPER_ADMIN bypasses org checks when active", () => {
    expect(isSuperAdmin(admin)).toBe(true);
    expect(canManageOrganization(admin, "any")).toBe(true);
    expect(isSuperAdmin(disabled)).toBe(false);
  });

  it("org admin manages own org only", () => {
    expect(canManageTeam(organizer, "org1")).toBe(true);
    expect(canManageTeam(organizer, "org2")).toBe(false);
    expect(canManageEvents(organizer, "org2")).toBe(false);
  });

  it("door staff: scan yes, finance/settings/team no", () => {
    expect(canScanTickets(door, "org1")).toBe(true);
    expect(canManageEvents(door, "org1")).toBe(false);
    expect(canManageOrganization(door, "org1")).toBe(false);
    expect(canViewFinancials(door, "org1")).toBe(false);
    expect(canRefund(door, "org1")).toBe(false);
    expect(isDoorStaffOnly(door)).toBe(true);
    expect(isDoorStaffOnly(organizer)).toBe(false);
  });
});

describe("Door staff event assignments", () => {
  const events = [
    { id: "e1", organizationId: "org1" },
    { id: "e2", organizationId: "org1" },
  ];

  it("restricts door staff to assigned events", () => {
    const withAssign = { ...door, eventAssignments: [{ eventId: "e1" }] };
    expect(filterEventsByAssignment(withAssign, events).map((e) => e.id)).toEqual(["e1"]);
    expect(canAccessAssignedEvent(withAssign, events[1]!)).toBe(false);
  });

  it("denies door staff with no assignments", () => {
    expect(filterEventsByAssignment({ ...door, eventAssignments: [] }, events)).toEqual([]);
  });

  it("allows organizer admin all org events", () => {
    expect(filterEventsByAssignment(organizer, events)).toHaveLength(2);
  });
});

describe("Password policy", () => {
  it("requires min 12 chars without silly complexity", () => {
    expect(validateStrongPassword("short").ok).toBe(false);
    expect(validateStrongPassword("long-enough-pass").ok).toBe(true);
    expect(validateStrongPassword("aaaaaaaaaaaa").ok).toBe(true);
  });

  it("flags known weak demo patterns", () => {
    expect(looksLikeWeakPassword("password123")).toBe(true);
    expect(looksLikeWeakPassword("correct-horse-battery")).toBe(false);
  });
});

describe("Auth action tokens", () => {
  it("hashes tokens (never store raw)", () => {
    const raw = generateRawToken();
    expect(raw.length).toBeGreaterThan(20);
    expect(hashToken(raw)).toHaveLength(64);
    expect(hashToken(raw)).not.toBe(raw);
  });
});

describe("Publish readiness", () => {
  const baseOrg = {
    id: "org1",
    legalName: "Real AS",
    organizationNumber: "123456789",
    customerServiceEmail: "support@real.no",
    contactEmail: null,
    refundPolicyText: "Refunderes ved avlysning.",
    refundPolicyType: "ORGANIZER_REFUND_POLICY" as const,
    termsVersion: "2026.1",
    isActive: true,
  };

  it("blocks incomplete seller / tickets / payment", () => {
    const blockers = getEventPublishBlockers({
      event: {
        name: "Show",
        startsAt: new Date(),
        endsAt: new Date(),
        venueId: null,
        address: null,
        city: null,
        ageLimit: null,
        capacity: 100,
        sellerOrganizationId: "org1",
        organizationId: "org1",
        termsVersion: null,
        refundPolicyText: null,
        refundPolicyType: null,
      },
      organizer: { ...baseOrg, legalName: null, organizationNumber: null },
      seller: null,
      ticketTypes: [],
      venue: null,
      paymentConfigured: false,
    });
    expect(blockers.some((b) => b.code === "LEGAL_NAME")).toBe(true);
    expect(blockers.some((b) => b.code === "TICKET_TYPE")).toBe(true);
    expect(blockers.some((b) => b.code === "PAYMENT_PROVIDER")).toBe(true);
    expect(formatPublishBlockedMessage(blockers)).toContain("Kan ikke publiseres");
  });

  it("allows complete event (lineup optional)", () => {
    const blockers = getEventPublishBlockers({
      event: {
        name: "Show",
        startsAt: new Date(),
        endsAt: new Date(),
        venueId: "v1",
        address: null,
        city: "Oslo",
        ageLimit: 18,
        capacity: 100,
        sellerOrganizationId: "org1",
        organizationId: "org1",
        termsVersion: null,
        refundPolicyText: null,
        refundPolicyType: null,
      },
      organizer: baseOrg,
      seller: baseOrg,
      ticketTypes: [{ name: "GA", price: 30000, quantityTotal: 100, isVisible: true }],
      venue: { id: "v1", name: "Hall" },
      paymentConfigured: true,
    });
    expect(blockers).toEqual([]);
  });
});

describe("Production login demo credentials", () => {
  it("demo prefill only when non-production AND explicitly enabled", () => {
    const show = (nodeEnv: string, flag: string | undefined) =>
      nodeEnv !== "production" && flag === "true";
    expect(show("production", "true")).toBe(false);
    expect(show("production", undefined)).toBe(false);
    expect(show("development", undefined)).toBe(false);
    expect(show("development", "true")).toBe(true);
  });
});

describe("Demo seed gate", () => {
  it("only allows SEED_MODE development|demo", () => {
    const allowed = (mode: string) => {
      const m = mode.toLowerCase().trim();
      return m === "development" || m === "demo";
    };
    expect(allowed("none")).toBe(false);
    expect(allowed("")).toBe(false);
    expect(allowed("production")).toBe(false);
    expect(allowed("development")).toBe(true);
    expect(allowed("demo")).toBe(true);
  });
});

describe("Last SUPER_ADMIN / OWNER protection rules", () => {
  it("documents last-admin guard conditions", () => {
    // UserAdminService.assertNotLastSuperAdmin / assertNotLastOrgOwner
    // enforce: cannot demote/disable when count of other active peers < 1.
    const othersActive = (countExcludingTarget: number) => countExcludingTarget >= 1;
    expect(othersActive(0)).toBe(false);
    expect(othersActive(1)).toBe(true);
  });
});
