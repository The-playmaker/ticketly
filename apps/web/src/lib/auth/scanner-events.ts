import type { EventStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canScanTickets, type AuthUser } from "@/lib/auth/rbac";
import { filterEventsByAssignment } from "@/lib/auth/event-access";
import {
  selectScannerEvent,
  SCANNABLE_EVENT_STATUSES,
} from "@/lib/auth/scannable-events";

export { selectScannerEvent };

type UserWithAssignments = AuthUser & {
  eventAssignments?: { eventId: string }[];
};

export type ScannerEventRow = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  startsAt: Date;
  endsAt: Date;
  status: EventStatus;
};

/**
 * Load events the user may scan.
 *
 * Always unions explicit EventAssignment rows so assigned events are not
 * dropped by `take` when an org has many older COMPLETED events.
 */
export async function loadAccessibleScannerEvents(
  user: UserWithAssignments
): Promise<ScannerEventRow[]> {
  const assignedIds = [
    ...new Set((user.eventAssignments ?? []).map((a) => a.eventId)),
  ];

  const select = {
    id: true,
    name: true,
    slug: true,
    organizationId: true,
    startsAt: true,
    endsAt: true,
    status: true,
  } as const;

  const membershipOrAssignmentWhere =
    user.globalRole === "SUPER_ADMIN"
      ? {}
      : {
          OR: [
            ...(assignedIds.length ? [{ id: { in: assignedIds } }] : []),
            {
              organization: {
                members: { some: { userId: user.id, isActive: true } },
              },
            },
          ],
        };

  // Recent-first so take:50 keeps current/upcoming events, not ancient COMPLETED.
  const recent = await prisma.event.findMany({
    where: {
      status: { in: SCANNABLE_EVENT_STATUSES },
      ...membershipOrAssignmentWhere,
    },
    select,
    orderBy: { startsAt: "desc" },
    take: 50,
  });

  let assigned: ScannerEventRow[] = [];
  if (assignedIds.length) {
    const missing = assignedIds.filter((id) => !recent.some((e) => e.id === id));
    if (missing.length) {
      assigned = await prisma.event.findMany({
        where: {
          id: { in: missing },
          status: { in: SCANNABLE_EVENT_STATUSES },
        },
        select,
      });
    }
  }

  const byId = new Map<string, ScannerEventRow>();
  for (const e of [...assigned, ...recent]) byId.set(e.id, e);

  const scannable = [...byId.values()].filter((e) =>
    canScanTickets(user, e.organizationId)
  );
  return filterEventsByAssignment(user, scannable);
}
