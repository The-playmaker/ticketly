import {
  CheckInResult,
  TicketQrMode,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashTicketToken } from "@/lib/tickets/token";
import {
  isDynamicQrFeatureEnabled,
  looksLikeDynamicQrCredential,
  parseDynamicQrCredential,
  verifyDynamicQrMac,
} from "@/lib/tickets/dynamic-qr";
import { assertDeviceNotRevoked } from "@/lib/auth/org-access";
import { AppError } from "@/lib/api-error";
import {
  type CheckInResponse,
  type CheckInEventAccess,
} from "@/services/check-in-shared";
import { admitLockedTicket } from "@/services/check-in-admit";

export type { CheckInResponse, CheckInEventAccess } from "@/services/check-in-shared";

export class CheckInService {
  /**
   * Atomic check-in: validates token by hash (legacy secureToken fallback)
   * and ensures two scanners cannot approve the same ticket concurrently.
   * Dynamic QR credentials are verified separately and never fall back to static hashing.
   */
  static async checkInByToken(input: {
    token: string;
    eventId: string;
    checkedInBy?: string;
    deviceId?: string;
    isManual?: boolean;
    note?: string;
    eventAccess?: CheckInEventAccess;
  }): Promise<CheckInResponse> {
    try {
      await assertDeviceNotRevoked(input.deviceId);
    } catch (e) {
      if (e instanceof AppError && e.code === "DEVICE_REVOKED") {
        await prisma.checkIn.create({
          data: {
            eventId: input.eventId,
            result: CheckInResult.INVALID,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            note: "device_revoked",
          },
        });
        return { result: CheckInResult.INVALID, message: "SCANNER DEAKTIVERT" };
      }
      throw e;
    }
    if (looksLikeDynamicQrCredential(input.token)) {
      return this.checkInByDynamicCredential(input);
    }
    const tokenHash = hashTicketToken(input.token);
    return prisma.$transaction(async (tx) => {
      // Lock by hash first; fallback to deprecated plaintext column during migration
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Ticket"
        WHERE "tokenHash" = ${tokenHash}
           OR "secureToken" = ${input.token}
        FOR UPDATE
      `;
      if (!rows[0]) {
        await tx.checkIn.create({
          data: {
            eventId: input.eventId,
            result: CheckInResult.INVALID,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            isManual: input.isManual ?? false,
            note: input.note,
          },
        });
        return {
          result: CheckInResult.INVALID,
          message: "UGYLDIG BILLETT",
        };
      }
      return admitLockedTicket(tx, {
        ticketId: rows[0].id,
        eventId: input.eventId,
        checkedInBy: input.checkedInBy,
        deviceId: input.deviceId,
        isManual: input.isManual ?? false,
        note: input.note,
        eventAccess: input.eventAccess,
        selectedEventId: input.eventId,
      });
    });
  }
  /**
   * Dynamic QR path — server verifies expiry, MAC, event, revocation, status.
   * Does not reveal or accept the long-lived ticket secret in the payload.
   */
  private static async checkInByDynamicCredential(input: {
    token: string;
    eventId: string;
    checkedInBy?: string;
    deviceId?: string;
    isManual?: boolean;
    note?: string;
    eventAccess?: CheckInEventAccess;
  }): Promise<CheckInResponse> {
    if (!isDynamicQrFeatureEnabled()) {
      await prisma.checkIn.create({
        data: {
          eventId: input.eventId,
          result: CheckInResult.INVALID,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          isManual: false,
          note: "dynamic_qr_feature_off",
        },
      });
      return { result: CheckInResult.INVALID, message: "UGYLDIG BILLETT" };
    }
    const parsed = parseDynamicQrCredential(input.token);
    if (!parsed.ok) {
      await prisma.checkIn.create({
        data: {
          eventId: input.eventId,
          result: CheckInResult.INVALID,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          note: `dynamic_qr_${parsed.reason.toLowerCase()}`,
        },
      });
      return {
        result: CheckInResult.INVALID,
        message: parsed.reason === "EXPIRED" ? "UTLØPT QR" : "UGYLDIG BILLETT",
      };
    }
    const { claims, mac } = parsed;
    let effectiveEventId = input.eventId;
    if (claims.eid !== input.eventId) {
      const claimEvent = await prisma.event.findUnique({
        where: { id: claims.eid },
        select: { id: true, organizationId: true, name: true },
      });
      if (claimEvent && input.eventAccess?.canAccessEvent(claimEvent)) {
        // Staff selected the wrong scanner event but may scan this ticket's event.
        effectiveEventId = claims.eid;
      } else {
        await prisma.checkIn.create({
          data: {
            eventId: input.eventId,
            result: CheckInResult.WRONG_EVENT,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
          },
        });
        return {
          result: CheckInResult.WRONG_EVENT,
          message: "FEIL ARRANGEMENT",
        };
      }
    }
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Ticket"
        WHERE "publicId" = ${claims.pid} AND "eventId" = ${claims.eid}
        FOR UPDATE
      `;
      if (!rows[0]) {
        await tx.checkIn.create({
          data: {
            eventId: effectiveEventId,
            result: CheckInResult.INVALID,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
          },
        });
        return { result: CheckInResult.INVALID, message: "UGYLDIG BILLETT" };
      }
      const ticket = await tx.ticket.findUniqueOrThrow({
        where: { id: rows[0].id },
        include: { event: true },
      });
      if (ticket.event.qrMode !== TicketQrMode.DYNAMIC_QR) {
        await tx.checkIn.create({
          data: {
            ticketId: ticket.id,
            eventId: effectiveEventId,
            result: CheckInResult.INVALID,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            note: "dynamic_qr_event_static_mode",
          },
        });
        return { result: CheckInResult.INVALID, message: "UGYLDIG BILLETT" };
      }
      if (!ticket.tokenHash || !verifyDynamicQrMac(claims, mac, ticket.tokenHash)) {
        await tx.checkIn.create({
          data: {
            ticketId: ticket.id,
            eventId: effectiveEventId,
            result: CheckInResult.INVALID,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            note: "dynamic_qr_mac_fail",
          },
        });
        return { result: CheckInResult.INVALID, message: "UGYLDIG BILLETT" };
      }
      return admitLockedTicket(tx, {
        ticketId: ticket.id,
        eventId: effectiveEventId,
        checkedInBy: input.checkedInBy,
        deviceId: input.deviceId,
        isManual: false,
        note: input.note,
        eventAccess: input.eventAccess,
        selectedEventId: input.eventId,
      });
    });
  }
  static async checkInByTicketId(input: {
    ticketId: string;
    eventId: string;
    checkedInBy?: string;
    deviceId?: string;
    note?: string;
    forceOverride?: boolean;
    eventAccess?: CheckInEventAccess;
  }) {
    try {
      await assertDeviceNotRevoked(input.deviceId);
    } catch (e) {
      if (e instanceof AppError && e.code === "DEVICE_REVOKED") {
        await prisma.checkIn.create({
          data: {
            eventId: input.eventId,
            result: CheckInResult.INVALID,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            isManual: true,
            note: "device_revoked",
          },
        });
        return { result: CheckInResult.INVALID, message: "SCANNER DEAKTIVERT" } satisfies CheckInResponse;
      }
      throw e;
    }
    const ticket = await prisma.ticket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) {
      return { result: CheckInResult.INVALID, message: "UGYLDIG BILLETT" } satisfies CheckInResponse;
    }
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${input.ticketId} FOR UPDATE`;
      return admitLockedTicket(tx, {
        ticketId: input.ticketId,
        eventId: input.eventId,
        checkedInBy: input.checkedInBy,
        deviceId: input.deviceId,
        isManual: true,
        note: input.note,
        forceOverride: input.forceOverride,
        eventAccess: input.eventAccess,
        selectedEventId: input.eventId,
      });
    });
  }
  static async searchGuests(eventId: string, query: string) {
    const q = query.trim();
    if (!q) return [];
    return prisma.ticket.findMany({
      where: {
        eventId,
        OR: [
          { holderName: { contains: q, mode: "insensitive" } },
          { holderEmail: { contains: q, mode: "insensitive" } },
          { publicId: { contains: q, mode: "insensitive" } },
          { order: { orderNumber: { contains: q, mode: "insensitive" } } },
          { order: { customerPhone: { contains: q } } },
        ],
      },
      include: {
        ticketType: true,
        order: { select: { orderNumber: true, customerPhone: true } },
      },
      take: 25,
      orderBy: { createdAt: "desc" },
    });
  }
}
