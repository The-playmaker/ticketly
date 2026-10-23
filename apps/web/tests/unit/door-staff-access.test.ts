import { describe, expect, it } from "vitest";
import { GlobalRole, OrgRole } from "@prisma/client";
import {
  canAccessOrgConsole,
  canManageEvents,
  canManageOrganization,
  canManageTeam,
  canRefund,
  canScanTickets,
  canViewFinancials,
  type AuthUser,
} from "@/lib/auth/rbac";
import {
  canAccessAssignedEvent,
  filterEventsByAssignment,
  isDoorStaffOnly,
} from "@/lib/auth/event-access";
import {
  isScannableEventStatus,
  SCANNABLE_EVENT_STATUSES,
} from "@/lib/auth/scannable-events";
import { resolvePostLoginPath } from "@/lib/auth/post-login";
import { orgRoleLabel } from "@/lib/auth/role-labels";
import { EventStatus } from "@prisma/client";

const door: AuthUser = {
  id: "u-door",
  email: "door@example.com",
  globalRole: GlobalRole.CUSTOMER,
  isActive: true,
  memberships: [
    { organizationId: "org1", role: OrgRole.DOOR_STAFF, canRefund: false, isActive: true },
  ],
};

const manager: AuthUser = {
  id: "u-mgr",
  email: "manager@example.com",
  globalRole: GlobalRole.CUSTOMER,
  isActive: true,
  memberships: [
    { organizationId: "org1", role: OrgRole.EVENT_MANAGER, canRefund: false, isActive: true },
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

const events = [
  { id: "e1", organizationId: "org1" },
  { id: "e2", organizationId: "org1" },
];

describe("DOOR_STAFF event assignment enforcement", () => {
  it("assigned door staff can only access that event", () => {
    const withAssign = { ...door, eventAssignments: [{ eventId: "e1" }] };
    expect(filterEventsByAssignment(withAssign, events).map((e) => e.id)).toEqual(["e1"]);
    expect(canAccessAssignedEvent(withAssign, events[0]!)).toBe(true);
    expect(canAccessAssignedEvent(withAssign, events[1]!)).toBe(false);
    expect(canScanTickets(withAssign, "org1")).toBe(true);
  });

  it("cannot scan another event in the same org", () => {
    const withAssign = { ...door, eventAssignments: [{ eventId: "e1" }] };
    expect(filterEventsByAssignment(withAssign, [events[1]!])).toEqual([]);
  });

  it("no assignments ⇒ no scanner events", () => {
    expect(filterEventsByAssignment({ ...door, eventAssignments: [] }, events)).toEqual([]);
    expect(canAccessAssignedEvent({ ...door, eventAssignments: [] }, events[0]!)).toBe(false);
  });
});

describe("DOOR_STAFF admin / financial denial", () => {
  it("cannot access org console, financials, refunds, team, or event manage", () => {
    expect(isDoorStaffOnly(door)).toBe(true);
    expect(canAccessOrgConsole(door, "org1")).toBe(false);
    expect(canViewFinancials(door, "org1")).toBe(false);
    expect(canRefund(door, "org1")).toBe(false);
    expect(canManageTeam(door, "org1")).toBe(false);
    expect(canManageOrganization(door, "org1")).toBe(false);
    expect(canManageEvents(door, "org1")).toBe(false);
  });

  it("post-login redirects door staff to /scan (not admin dashboard)", () => {
    expect(resolvePostLoginPath(door, "/admin")).toBe("/scan");
    expect(resolvePostLoginPath(door, "/admin/orders")).toBe("/scan");
    expect(resolvePostLoginPath(door)).toBe("/scan");
  });
});

describe("EVENT_MANAGER / ORGANIZER_ADMIN unchanged", () => {
  it("organizer admin keeps full console + all events", () => {
    expect(isDoorStaffOnly(organizer)).toBe(false);
    expect(canAccessOrgConsole(organizer, "org1")).toBe(true);
    expect(canViewFinancials(organizer, "org1")).toBe(true);
    expect(canManageTeam(organizer, "org1")).toBe(true);
    expect(filterEventsByAssignment(organizer, events)).toHaveLength(2);
    expect(resolvePostLoginPath(organizer, "/admin")).toBe("/admin");
  });

  it("event manager keeps console; empty assignments = all events", () => {
    expect(isDoorStaffOnly(manager)).toBe(false);
    expect(canAccessOrgConsole(manager, "org1")).toBe(true);
    expect(canManageEvents(manager, "org1")).toBe(true);
    expect(canViewFinancials(manager, "org1")).toBe(true);
    expect(filterEventsByAssignment({ ...manager, eventAssignments: [] }, events)).toHaveLength(2);
    expect(
      filterEventsByAssignment({ ...manager, eventAssignments: [{ eventId: "e2" }] }, events).map(
        (e) => e.id
      )
    ).toEqual(["e2"]);
    expect(resolvePostLoginPath(manager, "/admin")).toBe("/admin");
  });
});

describe("Friendly role labels", () => {
  it("maps org roles without changing enum values", () => {
    expect(OrgRole.ORGANIZER_ADMIN).toBe("ORGANIZER_ADMIN");
    expect(OrgRole.EVENT_MANAGER).toBe("EVENT_MANAGER");
    expect(OrgRole.DOOR_STAFF).toBe("DOOR_STAFF");
    expect(orgRoleLabel("ORGANIZER_ADMIN")).toBe("Administrator");
    expect(orgRoleLabel("EVENT_MANAGER")).toBe("Eventansvarlig");
    expect(orgRoleLabel("DOOR_STAFF")).toBe("Dør / scanner");
  });
});

describe("Member event-assignment PATCH contract", () => {
  it("documents update payload for existing DOOR_STAFF / EVENT_MANAGER", () => {
    // Team UI: PATCH /api/admin/team with action update + restrictedEventIds
    const payload = {
      organizationId: "org1",
      userId: "u-door",
      action: "update" as const,
      restrictedEventIds: ["e1"],
    };
    expect(payload.action).toBe("update");
    expect(payload.restrictedEventIds).toEqual(["e1"]);

    const clearAll = { ...payload, restrictedEventIds: [] as string[] };
    expect(clearAll.restrictedEventIds).toEqual([]);
  });
});

describe("Scanner event status filter (PAUSED sales ≠ no validation)", () => {
  it("includes PAUSED alongside PUBLISHED / SOLD_OUT / COMPLETED", () => {
    expect(SCANNABLE_EVENT_STATUSES).toContain(EventStatus.PAUSED);
    expect(SCANNABLE_EVENT_STATUSES).toContain(EventStatus.PUBLISHED);
    expect(SCANNABLE_EVENT_STATUSES).toContain(EventStatus.SOLD_OUT);
    expect(SCANNABLE_EVENT_STATUSES).toContain(EventStatus.COMPLETED);
    expect(SCANNABLE_EVENT_STATUSES).not.toContain(EventStatus.DRAFT);
    expect(SCANNABLE_EVENT_STATUSES).not.toContain(EventStatus.CANCELLED);
    expect(isScannableEventStatus("PAUSED")).toBe(true);
    expect(isScannableEventStatus("DRAFT")).toBe(false);
  });

  it("assigned DOOR_STAFF still sees PAUSED events after status filter + assignment filter", () => {
    const withAssign = { ...door, eventAssignments: [{ eventId: "e1" }] };
    const dbEvents = [
      { id: "e1", organizationId: "org1", status: EventStatus.PAUSED },
      { id: "e2", organizationId: "org1", status: EventStatus.PUBLISHED },
      { id: "e3", organizationId: "org1", status: EventStatus.DRAFT },
    ];
    const afterStatus = dbEvents.filter((e) => isScannableEventStatus(e.status));
    expect(afterStatus.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    const accessible = filterEventsByAssignment(withAssign, afterStatus);
    expect(accessible.map((e) => e.id)).toEqual(["e1"]);
  });

  it("no assignment ⇒ empty scanner list even when PAUSED events exist", () => {
    const dbEvents = [
      { id: "e1", organizationId: "org1", status: EventStatus.PAUSED },
    ].filter((e) => isScannableEventStatus(e.status));
    expect(
      filterEventsByAssignment({ ...door, eventAssignments: [] }, dbEvents)
    ).toEqual([]);
  });

  it("cannot scan unassigned event even if PUBLISHED", () => {
    const withAssign = { ...door, eventAssignments: [{ eventId: "e1" }] };
    const other = { id: "e2", organizationId: "org1", status: EventStatus.PUBLISHED };
    expect(filterEventsByAssignment(withAssign, [other])).toEqual([]);
    expect(canAccessAssignedEvent(withAssign, other)).toBe(false);
  });

  it("login path: door staff with assignment reaches /scan (not admin)", () => {
    const withAssign = { ...door, eventAssignments: [{ eventId: "e1" }] };
    expect(resolvePostLoginPath(withAssign)).toBe("/scan");
    expect(canScanTickets(withAssign, "org1")).toBe(true);
    expect(
      filterEventsByAssignment(withAssign, [
        { id: "e1", organizationId: "org1", status: EventStatus.PAUSED },
      ])
    ).toHaveLength(1);
  });
});
