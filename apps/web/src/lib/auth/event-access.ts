import { OrgRole, type GlobalRole } from "@prisma/client";
import type { AuthUser } from "@/lib/auth/rbac";
import { isSuperAdmin } from "@/lib/auth/rbac";

type UserWithAssignments = AuthUser & {
  eventAssignments?: { eventId: string }[];
};

/**
 * Door staff: assigned events only (no assignments ⇒ no events).
 * ORGANIZER_ADMIN: all org events.
 * EVENT_MANAGER: all org events unless they have explicit assignments (then only those).
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

    if (membership.role === OrgRole.DOOR_STAFF) {
      return assignedIds.has(event.id);
    }

    if (membership.role === OrgRole.ORGANIZER_ADMIN) {
      return true;
    }

    if (membership.role === OrgRole.EVENT_MANAGER) {
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
