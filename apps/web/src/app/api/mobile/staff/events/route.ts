import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";
import { canScanTickets } from "@/lib/auth/rbac";
import { filterEventsByAssignment } from "@/lib/auth/event-access";
import { SCANNABLE_EVENT_STATUSES } from "@/lib/auth/scannable-events";

export async function GET(req: Request) {
  const userId = await verifyMobileSession(req.headers.get("authorization"));
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      memberships: { where: { isActive: true } },
      eventAssignments: { select: { eventId: true } },
    },
  });

  if (!user.isActive) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Konto deaktivert" } },
      { status: 401 }
    );
  }

  const authUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    globalRole: user.globalRole,
    isActive: user.isActive,
    memberships: user.memberships,
    eventAssignments: user.eventAssignments,
  };

  const events = await prisma.event.findMany({
    where: {
      // Include PAUSED: paused sales must not block ticket validation
      status: { in: SCANNABLE_EVENT_STATUSES },
      OR: [
        { assignments: { some: { userId } } },
        { organization: { members: { some: { userId, isActive: true } } } },
        ...(user.globalRole === "SUPER_ADMIN" ? [{}] : []),
      ],
    },
    select: { id: true, name: true, organizationId: true },
  });

  const scannable = events.filter((e) => canScanTickets(authUser, e.organizationId));
  return NextResponse.json({
    events: filterEventsByAssignment(authUser, scannable),
  });
}
