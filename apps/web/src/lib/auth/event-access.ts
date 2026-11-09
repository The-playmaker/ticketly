import { OrgRole, type GlobalRole } from "@prisma/client";
import type { AuthUser } from "@/lib/auth/rbac";
import { isSuperAdmin } from "@/lib/auth/rbac";

type UserWithAssignments = AuthUser & {
  eventAssignments?: { eventId: string }[];
};

/**
 * ORGANIZER_ADMIN: all org events.
 * EVENT_MANAGER / DOOR_STAFF: all org events unless they have explicit
 * assignments (then only those). Previously door staff with no assignments
 * saw nothing, so every new event silently locked them out of the scanner
 * until an admin remembered to assign it.
 */
export function filterEventsByAssignment<
  T extends { id: string; organizationId: string },
>(user: UserWithAssignments, events: T[]): T[] {
  if (isSuperAdmin(user)) return events;

  const assignedIds = new Set((user.eventAssignments ?? []).map((a) => a.eventId));

  return events.filter((event) => {
    const membership = user.memberships?.find(
      (m) => m.organizationId === event.organizationId && m.isActive
    );
    if (!membership) return false;

    if (membership.role === OrgRole.ORGANIZER_ADMIN) {
      return true;
    }

    if (
      membership.role === OrgRole.EVENT_MANAGER ||
      membership.role === OrgRole.DOOR_STAFF
    ) {
      if (assignedIds.size === 0) return true;
      return assignedIds.has(event.id);
    }

    return false;
  });
}

export function canAccessAssignedEvent(
  user: UserWithAssignments,
  event: { id: string; organizationId: string }
): boolean {
  return filterEventsByAssignment(user, [event]).length === 1;
}

export function isDoorStaffOnly(
  user:
    | { globalRole: GlobalRole; memberships?: { role: OrgRole; isActive: boolean }[] }
    | null
    | undefined
): boolean {
  if (!user) return false;
  if (user.globalRole === "SUPER_ADMIN") return false;
  const active = user.memberships?.filter((m) => m.isActive) ?? [];
  if (!active.length) return false;
  return active.every((m) => m.role === OrgRole.DOOR_STAFF);
}
