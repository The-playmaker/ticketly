import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";
import {
  loadAccessibleScannerEvents,
  selectScannerEvent,
} from "@/lib/auth/scanner-events";

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

  const accessible = await loadAccessibleScannerEvents(authUser);
  const preferred = selectScannerEvent(accessible);

  // Preferred first so mobile auto-selects the live/upcoming event
  const ordered = preferred
    ? [preferred, ...accessible.filter((e) => e.id !== preferred.id)]
    : accessible;

  return NextResponse.json({
    events: ordered.map((e) => ({
      id: e.id,
      name: e.name,
      organizationId: e.organizationId,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
    })),
  });
}
