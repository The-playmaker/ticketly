import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";
import { canScanTickets } from "@/lib/auth/rbac";

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
      eventAssignments: true,
    },
  });

  const authUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    globalRole: user.globalRole,
    isActive: user.isActive,
    memberships: user.memberships,
  };

  const events = await prisma.event.findMany({
    where: {
      status: { in: ["PUBLISHED", "SOLD_OUT", "COMPLETED"] },
      OR: [
        { assignments: { some: { userId } } },
        { organization: { members: { some: { userId, isActive: true } } } },
        ...(user.globalRole === "SUPER_ADMIN" ? [{}] : []),
      ],
    },
    select: { id: true, name: true, organizationId: true },
  });

  return NextResponse.json({
    events: events.filter((e) => canScanTickets(authUser, e.organizationId)),
  });
}
