import { NextResponse } from "next/server";
import { offlineSyncSchema } from "@ticketly/validation";
import { OfflineScannerService } from "@ticketly/ticketing";
import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";
import { prisma } from "@/lib/db";
import { assertCanScanEvent, assertDeviceNotRevoked } from "@/lib/auth/org-access";
import { AppError } from "@/lib/api-error";

export async function POST(req: Request) {
  const userId = await verifyMobileSession(req.headers.get("authorization"));
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const parsed = offlineSyncSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Ugyldig payload" } },
      { status: 400 }
    );
  }

  try {
    await assertDeviceNotRevoked(parsed.data.deviceId);
  } catch {
    return NextResponse.json(
      { error: { code: "DEVICE_REVOKED", message: "Scanner deaktivert" } },
      { status: 403 }
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      memberships: { where: { isActive: true } },
      eventAssignments: { select: { eventId: true } },
    },
  });

  try {
    await assertCanScanEvent(
      {
        id: user.id,
        email: user.email,
        globalRole: user.globalRole,
        isActive: user.isActive,
        memberships: user.memberships,
        eventAssignments: user.eventAssignments,
      },
      parsed.data.eventId
    );
  } catch (e) {
    if (e instanceof AppError) {
      return NextResponse.json(
        { error: { code: e.code, message: e.message } },
        { status: e.status }
      );
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const results = await OfflineScannerService.syncCheckIns({
    eventId: parsed.data.eventId,
    deviceId: parsed.data.deviceId,
    checkIns: parsed.data.checkIns.map((c) => ({
      ...c,
      eventId: parsed.data.eventId,
      staffUserId: c.staffUserId ?? userId,
    })),
  });

  return NextResponse.json({ results });
}
