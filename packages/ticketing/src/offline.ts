import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import type { OfflineTicketEntry, OfflineCheckInPayload, ScanResultCode } from "@ticketly/shared-types";
import {
  prisma,
  CheckInResult,
  OfflineSyncStatus,
  TicketStatus,
  TicketQrMode,
} from "@ticketly/database";

/**
 * Offline scanner design
 * ----------------------
 * Preferred mode: online atomic check-in via server.
 *
 * Offline mode (unstable venue networks):
 * 1. Staff downloads an OfflineValidationBundle for ONE event.
 * 2. Bundle payload is encrypted; contains publicId + tokenHash + status + ticketTypeName.
 *    NO customer names, emails, or phones.
 * 3. Local check-ins stored with sequence numbers and synced when online.
 * 4. Conflicts: if ticket already CHECKED_IN online or by another device,
 *    later offline SUCCESS is marked CONFLICT / rejected; first wins by server checkedInAt.
 *
 * LIMITATIONS (document to organizers):
 * - Offline validation cannot know about tickets sold AFTER the bundle was downloaded.
 * - Refunds/cancellations after download may incorrectly show VALID until re-sync.
 * - Bundle must be refreshed frequently (TTL).
 * - Cryptographic secrecy of bundle key must be protected on device (SecureStore).
 * - Online mode MUST be preferred whenever connectivity exists.
 */

const ALGO = "aes-256-gcm";

export function hashTicketToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getOfflineBundleKey(): Buffer {
  const secret = process.env.OFFLINE_BUNDLE_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("OFFLINE_BUNDLE_SECRET or AUTH_SECRET required for offline bundles");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptPayload(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptPayload(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function checksum(payload: string): string {
  return createHmac("sha256", getOfflineBundleKey()).update(payload).digest("hex");
}

export class OfflineScannerService {
  /** Build encrypted validation dataset for one event (minimal PII). */
  static async createBundle(eventId: string, ttlHours = 12) {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: {
        tickets: {
          where: { status: { in: [TicketStatus.VALID, TicketStatus.CHECKED_IN] } },
          include: { ticketType: { select: { name: true } } },
        },
      },
    });

    // Dynamic QR events cannot be validated securely offline — refuse bundle.
    if (event.qrMode === TicketQrMode.DYNAMIC_QR) {
      throw new Error(
        "OFFLINE_BUNDLE_UNSUPPORTED: Dynamic QR events require online scanners (no static fallback)"
      );
    }

    const entries: OfflineTicketEntry[] = event.tickets
      .map((t): OfflineTicketEntry | null => {
        const tokenHash = t.tokenHash || (t.secureToken ? hashTicketToken(t.secureToken) : "");
        if (!tokenHash) return null;
        const status: OfflineTicketEntry["status"] =
          t.status === TicketStatus.CHECKED_IN
            ? "CHECKED_IN"
            : t.status === TicketStatus.REFUNDED
              ? "REFUNDED"
              : t.status === TicketStatus.CANCELLED
                ? "CANCELLED"
                : "VALID";
        return {
          publicId: t.publicId,
          tokenHash,
          status,
          ticketTypeName: t.ticketType.name,
        };
      })
      .filter((e): e is OfflineTicketEntry => e != null);

    const plaintext = JSON.stringify({ eventId, generatedAt: new Date().toISOString(), entries });
    const key = getOfflineBundleKey();
    const encryptedPayload = encryptPayload(plaintext, key);
    const payloadChecksum = checksum(encryptedPayload);

    const latest = await prisma.offlineValidationBundle.findFirst({
      where: { eventId },
      orderBy: { version: "desc" },
    });
    const version = (latest?.version ?? 0) + 1;
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

    return prisma.offlineValidationBundle.create({
      data: {
        organizationId: event.organizationId,
        eventId,
        version,
        encryptedPayload,
        payloadChecksum,
        expiresAt,
      },
    });
  }

  /**
   * Sync offline check-ins. First successful check-in wins.
   * Conflict if ticket already checked in with different device/time.
   */
  static async syncCheckIns(input: {
    eventId: string;
    deviceId: string;
    checkIns: OfflineCheckInPayload[];
  }) {
    const results = [];

    for (const item of input.checkIns) {
      const existingLocal = await prisma.offlineCheckIn.findUnique({
        where: { localId: item.localId },
      });
      if (existingLocal?.syncStatus === OfflineSyncStatus.SYNCED) {
        results.push({ localId: item.localId, status: "ALREADY_SYNCED" });
        continue;
      }

      const recorded = await prisma.offlineCheckIn.upsert({
        where: { localId: item.localId },
        create: {
          localId: item.localId,
          sequenceNumber: item.sequenceNumber,
          eventId: input.eventId,
          ticketPublicId: item.ticketPublicId,
          ticketTokenHash: item.ticketTokenHash,
          deviceId: input.deviceId,
          staffUserId: item.staffUserId,
          localCheckedInAt: new Date(item.localCheckedInAt),
          result: item.result as CheckInResult,
          syncStatus: OfflineSyncStatus.PENDING,
        },
        update: {},
      });

      if (item.result !== "SUCCESS") {
        await prisma.offlineCheckIn.update({
          where: { id: recorded.id },
          data: { syncStatus: OfflineSyncStatus.SYNCED, syncedAt: new Date() },
        });
        results.push({ localId: item.localId, status: "RECORDED_NON_SUCCESS" });
        continue;
      }

      const ticket = await prisma.ticket.findFirst({
        where: { publicId: item.ticketPublicId, eventId: input.eventId },
      });

      const expectedHash = ticket?.tokenHash || (ticket?.secureToken ? hashTicketToken(ticket.secureToken) : null);
      if (!ticket || !expectedHash || expectedHash !== item.ticketTokenHash) {
        await prisma.offlineCheckIn.update({
          where: { id: recorded.id },
          data: {
            syncStatus: OfflineSyncStatus.REJECTED,
            conflictReason: "TOKEN_MISMATCH_OR_UNKNOWN",
            syncedAt: new Date(),
          },
        });
        results.push({ localId: item.localId, status: "REJECTED" });
        continue;
      }

      if (ticket.status === TicketStatus.CHECKED_IN) {
        await prisma.offlineCheckIn.update({
          where: { id: recorded.id },
          data: {
            syncStatus: OfflineSyncStatus.CONFLICT,
            conflictReason: "OFFLINE_CONFLICT_DUPLICATE",
            syncedAt: new Date(),
          },
        });
        results.push({
          localId: item.localId,
          status: "OFFLINE_CONFLICT_DUPLICATE",
          result: "ALREADY_USED" as ScanResultCode,
        });
        continue;
      }

      if (ticket.status !== TicketStatus.VALID) {
        await prisma.offlineCheckIn.update({
          where: { id: recorded.id },
          data: {
            syncStatus: OfflineSyncStatus.REJECTED,
            conflictReason: `TICKET_STATUS_${ticket.status}`,
            syncedAt: new Date(),
          },
        });
        results.push({ localId: item.localId, status: "REJECTED" });
        continue;
      }

      // Apply check-in atomically
      const checkIn = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticket.id} FOR UPDATE`;
        const fresh = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        if (fresh.status !== TicketStatus.VALID) {
          return null;
        }
        const now = new Date(item.localCheckedInAt);
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: TicketStatus.CHECKED_IN, checkedInAt: now },
        });
        return tx.checkIn.create({
          data: {
            ticketId: ticket.id,
            eventId: input.eventId,
            checkedInAt: now,
            checkedInBy: item.staffUserId,
            deviceId: input.deviceId,
            result: CheckInResult.SUCCESS,
            note: "offline-sync",
            isManual: false,
          },
        });
      });

      if (!checkIn) {
        await prisma.offlineCheckIn.update({
          where: { id: recorded.id },
          data: {
            syncStatus: OfflineSyncStatus.CONFLICT,
            conflictReason: "LOST_RACE_ON_SYNC",
            syncedAt: new Date(),
          },
        });
        results.push({ localId: item.localId, status: "CONFLICT" });
        continue;
      }

      await prisma.offlineCheckIn.update({
        where: { id: recorded.id },
        data: {
          syncStatus: OfflineSyncStatus.SYNCED,
          syncedCheckInId: checkIn.id,
          syncedAt: new Date(),
        },
      });
      results.push({ localId: item.localId, status: "SYNCED", checkInId: checkIn.id });
    }

    return results;
  }
}
