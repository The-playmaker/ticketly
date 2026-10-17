import { CheckInResult, OfflineSyncStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Organizer-facing security diagnostics (not customer-facing).
 * Aggregates scan abuse signals without exposing raw ticket credentials.
 */
export class FraudDiagnosticsService {
  static async forEvent(eventId: string, sinceHours = 24) {
    const since = new Date(Date.now() - sinceHours * 3600_000);
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { organizationId: true },
    });

    const [
      invalidScans,
      alreadyUsedAttempts,
      wrongEvent,
      revokedDeviceAttempts,
      offlineConflicts,
      recentInvalid,
      recentDuplicates,
      forceOverrideLogs,
      manualCheckInLogs,
    ] = await Promise.all([
      prisma.checkIn.count({
        where: { eventId, result: CheckInResult.INVALID, checkedInAt: { gte: since } },
      }),
      prisma.checkIn.count({
        where: { eventId, result: CheckInResult.ALREADY_USED, checkedInAt: { gte: since } },
      }),
      prisma.checkIn.count({
        where: { eventId, result: CheckInResult.WRONG_EVENT, checkedInAt: { gte: since } },
      }),
      prisma.checkIn.count({
        where: {
          eventId,
          checkedInAt: { gte: since },
          note: "device_revoked",
        },
      }),
      prisma.offlineCheckIn.count({
        where: {
          eventId,
          syncStatus: { in: [OfflineSyncStatus.CONFLICT, OfflineSyncStatus.REJECTED] },
          createdAt: { gte: since },
        },
      }),
      prisma.checkIn.findMany({
        where: { eventId, result: CheckInResult.INVALID, checkedInAt: { gte: since } },
        orderBy: { checkedInAt: "desc" },
        take: 20,
        select: {
          id: true,
          checkedInAt: true,
          deviceId: true,
          result: true,
          isManual: true,
          note: true,
          ticket: { select: { publicId: true } },
          staff: { select: { name: true } },
        },
      }),
      prisma.checkIn.findMany({
        where: { eventId, result: CheckInResult.ALREADY_USED, checkedInAt: { gte: since } },
        orderBy: { checkedInAt: "desc" },
        take: 20,
        select: {
          id: true,
          checkedInAt: true,
          deviceId: true,
          ticket: { select: { publicId: true } },
          staff: { select: { name: true } },
        },
      }),
      prisma.auditLog.findMany({
        where: {
          organizationId: event.organizationId,
          action: "CHECKIN_FORCE_OVERRIDE",
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          createdAt: true,
          actorId: true,
          entityId: true,
          metadata: true,
        },
      }),
      prisma.auditLog.count({
        where: {
          organizationId: event.organizationId,
          action: { in: ["CHECKIN_FORCE_OVERRIDE", "MANUAL_CHECKIN"] },
          createdAt: { gte: since },
        },
      }),
    ]);

    const recentForceOverrides = forceOverrideLogs.filter((r) => {
      const meta = r.metadata as { eventId?: string } | null;
      return !meta?.eventId || meta.eventId === eventId;
    }).slice(0, 20);

    const revokedDevices = await prisma.device.findMany({
      where: {
        organizationId: event.organizationId,
        revokedAt: { not: null },
        OR: [
          { offlineCheckIns: { some: { eventId, createdAt: { gte: since } } } },
          { id: { in: recentInvalid.map((r) => r.deviceId).filter((d): d is string => !!d) } },
        ],
      },
      select: { id: true, deviceName: true, revokedAt: true },
      take: 20,
    });

    return {
      windowHours: sinceHours,
      summary: {
        invalidScans,
        duplicateEntryAttempts: alreadyUsedAttempts,
        wrongEvent,
        revokedDeviceAttempts,
        manualOverrides: manualCheckInLogs,
        offlineSyncConflicts: offlineConflicts,
      },
      recentInvalidScans: recentInvalid.map((r) => ({
        id: r.id,
        at: r.checkedInAt,
        deviceId: r.deviceId,
        publicId: r.ticket?.publicId ?? null,
        staffName: r.staff?.name ?? null,
        isManual: r.isManual,
        note: r.note === "device_revoked" ? "device_revoked" : null,
      })),
      recentDuplicateAttempts: recentDuplicates.map((r) => ({
        id: r.id,
        at: r.checkedInAt,
        deviceId: r.deviceId,
        publicId: r.ticket?.publicId ?? null,
        staffName: r.staff?.name ?? null,
      })),
      recentForceOverrides: recentForceOverrides.map((r) => ({
        id: r.id,
        at: r.createdAt,
        actorId: r.actorId,
        ticketId: r.entityId,
        reason:
          r.metadata && typeof r.metadata === "object" && "reason" in r.metadata
            ? String((r.metadata as { reason?: unknown }).reason ?? "")
            : null,
      })),
      revokedDevicesActive: revokedDevices.map((d) => ({
        id: d.id,
        deviceName: d.deviceName,
        revokedAt: d.revokedAt,
      })),
    };
  }
}
