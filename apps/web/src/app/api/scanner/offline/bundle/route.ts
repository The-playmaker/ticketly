import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma, TicketStatus } from "@ticketly/database";
import { OfflineScannerService, decryptPayload, getOfflineBundleKey } from "@ticketly/ticketing";
import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";
import { assertCanScanEvent, assertDeviceNotRevoked } from "@/lib/auth/org-access";
import { AppError } from "@/lib/api-error";

export async function GET(req: Request) {
  const userId = await verifyMobileSession(req.headers.get("authorization"));
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");
  const deviceId = url.searchParams.get("deviceId");
  if (!eventId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "eventId required" } },
      { status: 400 }
    );
  }
  try {
    await assertDeviceNotRevoked(deviceId);
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
      eventId
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

  const bundle = await OfflineScannerService.createBundle(eventId);
  // Decrypt server-side to return entries to trusted staff device over TLS.
  // Encrypted blob remains available for strict offline packaging if needed.
  const plaintext = decryptPayload(bundle.encryptedPayload, getOfflineBundleKey());
  const parsed = JSON.parse(plaintext) as {
    entries: { publicId: string; tokenHash: string; status: string; ticketTypeName: string }[];
  };

  return NextResponse.json({
    eventId,
    version: bundle.version,
    expiresAt: bundle.expiresAt,
    entries: parsed.entries,
    encryptedPayload: bundle.encryptedPayload,
    payloadChecksum: bundle.payloadChecksum,
  });
}

// silence unused import if tree-shaken differently
void TicketStatus;
void createHash;
