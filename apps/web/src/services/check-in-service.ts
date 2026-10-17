import {
  CheckInResult,
  EventStatus,
  TicketQrMode,
  TicketStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { hashTicketToken } from "@/lib/tickets/token";
import {
  isDynamicQrFeatureEnabled,
  looksLikeDynamicQrCredential,
  parseDynamicQrCredential,
  verifyDynamicQrMac,
} from "@/lib/tickets/dynamic-qr";
import { assertTicketTransition } from "@/services/ticket-state-machine";
import { assertDeviceNotRevoked } from "@/lib/auth/org-access";
import { AppError } from "@/lib/api-error";

export type CheckInResponse = {
  result: CheckInResult;
  message: string;
  ticket?: {
    publicId: string;
    holderName: string | null;
    ticketType: string;
    checkedInAt?: Date | null;
    ageLimit?: number | null;
    requireIdCheck?: boolean;
    accessNote?: string | null;
  };
  previousCheckInAt?: Date | null;
  previousDeviceId?: string | null;
  previousCheckedInByName?: string | null;
};

function ticketDisplay(ticket: {
  publicId: string;
  holderName: string | null;
  ticketType: { name: string; description?: string | null };
  event: { ageLimit?: number | null };
  checkedInAt?: Date | null;
}) {
  const ageLimit = ticket.event.ageLimit ?? null;
  const desc = ticket.ticketType.description?.trim() || null;
  return {
    publicId: ticket.publicId,
    holderName: ticket.holderName,
    ticketType: ticket.ticketType.name,
    checkedInAt: ticket.checkedInAt ?? null,
    ageLimit,
    requireIdCheck: ageLimit != null && ageLimit > 0,
    accessNote: desc,
  };
}

function previousFromCheckIn(
  prev:
    | {
        checkedInAt: Date;
        deviceId: string | null;
        staff: { name: string | null } | null;
      }
    | undefined
    | null
) {
  if (!prev) {
    return {
      previousCheckInAt: null as Date | null,
      previousDeviceId: null as string | null,
      previousCheckedInByName: null as string | null,
    };
  }
  return {
    previousCheckInAt: prev.checkedInAt,
    previousDeviceId: prev.deviceId,
    previousCheckedInByName: prev.staff?.name ?? null,
  };
}

const ticketInclude = {
  ticketType: true,
  event: true,
  checkIns: {
    where: { result: CheckInResult.SUCCESS },
    orderBy: { checkedInAt: "desc" as const },
    take: 1,
    include: { staff: { select: { name: true } } },
  },
};

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

      return this.admitLockedTicket(tx, {
        ticketId: rows[0].id,
        eventId: input.eventId,
        checkedInBy: input.checkedInBy,
        deviceId: input.deviceId,
        isManual: input.isManual ?? false,
        note: input.note,
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
    if (claims.eid !== input.eventId) {
      await prisma.checkIn.create({
        data: {
          eventId: input.eventId,
          result: CheckInResult.WRONG_EVENT,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
        },
      });
      return { result: CheckInResult.WRONG_EVENT, message: "FEIL ARRANGEMENT" };
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
            eventId: input.eventId,
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
            eventId: input.eventId,
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
            eventId: input.eventId,
            result: CheckInResult.INVALID,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            note: "dynamic_qr_mac_fail",
          },
        });
        return { result: CheckInResult.INVALID, message: "UGYLDIG BILLETT" };
      }

      return this.admitLockedTicket(tx, {
        ticketId: ticket.id,
        eventId: input.eventId,
        checkedInBy: input.checkedInBy,
        deviceId: input.deviceId,
        isManual: false,
        note: input.note,
      });
    });
  }

  private static async admitLockedTicket(
    tx: Prisma.TransactionClient,
    input: {
      ticketId: string;
      eventId: string;
      checkedInBy?: string;
      deviceId?: string;
      isManual: boolean;
      note?: string;
      forceOverride?: boolean;
    }
  ): Promise<CheckInResponse> {
    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: input.ticketId },
      include: ticketInclude,
    });

    if (ticket.eventId !== input.eventId) {
      await tx.checkIn.create({
        data: {
          ticketId: ticket.id,
          eventId: input.eventId,
          result: CheckInResult.WRONG_EVENT,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          isManual: input.isManual,
        },
      });
      return {
        result: CheckInResult.WRONG_EVENT,
        message: "FEIL ARRANGEMENT",
        ticket: ticketDisplay(ticket),
      };
    }

    if (ticket.event.status === EventStatus.CANCELLED) {
      await tx.checkIn.create({
        data: {
          ticketId: ticket.id,
          eventId: input.eventId,
          result: CheckInResult.EVENT_CANCELLED,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          isManual: input.isManual,
        },
      });
      return {
        result: CheckInResult.EVENT_CANCELLED,
        message: "KANSELLERT",
        ticket: ticketDisplay(ticket),
      };
    }

    if (ticket.status === TicketStatus.TRANSFERRED) {
      await tx.checkIn.create({
        data: {
          ticketId: ticket.id,
          eventId: input.eventId,
          result: CheckInResult.INVALID,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          isManual: input.isManual,
        },
      });
      return {
        result: CheckInResult.INVALID,
        message: "OVERFØRT",
        ticket: ticketDisplay(ticket),
      };
    }

    if (ticket.status === TicketStatus.REFUNDED || ticket.status === TicketStatus.CANCELLED) {
      const result =
        ticket.status === TicketStatus.REFUNDED
          ? CheckInResult.REFUNDED
          : CheckInResult.CANCELLED;
      await tx.checkIn.create({
        data: {
          ticketId: ticket.id,
          eventId: input.eventId,
          result,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          isManual: input.isManual,
        },
      });
      return {
        result,
        message: ticket.status === TicketStatus.REFUNDED ? "REFUNDERT" : "KANSELLERT",
        ticket: ticketDisplay(ticket),
      };
    }

    if (ticket.status === TicketStatus.CHECKED_IN) {
      const prev = ticket.checkIns[0];
      const prevMeta = previousFromCheckIn(prev);

      if (input.forceOverride) {
        const now = new Date();
        await tx.checkIn.create({
          data: {
            ticketId: ticket.id,
            eventId: input.eventId,
            result: CheckInResult.SUCCESS,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            isManual: true,
            note: input.note,
            checkedInAt: now,
          },
        });
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { checkedInAt: now },
        });
        if (input.checkedInBy) {
          await writeAuditLog({
            actorId: input.checkedInBy,
            action: "CHECKIN_FORCE_OVERRIDE",
            entityType: "Ticket",
            entityId: ticket.id,
            organizationId: ticket.event.organizationId,
            metadata: {
              eventId: input.eventId,
              deviceId: input.deviceId,
              reason: input.note ?? null,
              previousCheckInAt: prevMeta.previousCheckInAt?.toISOString() ?? null,
            },
          });
        }
        return {
          result: CheckInResult.SUCCESS,
          message: "GYLDIG",
          ticket: { ...ticketDisplay(ticket), checkedInAt: now },
          ...prevMeta,
        };
      }

      await tx.checkIn.create({
        data: {
          ticketId: ticket.id,
          eventId: input.eventId,
          result: CheckInResult.ALREADY_USED,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          isManual: input.isManual,
        },
      });
      return {
        result: CheckInResult.ALREADY_USED,
        message: "ALLEREDE BRUKT",
        previousCheckInAt: prevMeta.previousCheckInAt ?? ticket.checkedInAt,
        previousDeviceId: prevMeta.previousDeviceId,
        previousCheckedInByName: prevMeta.previousCheckedInByName,
        ticket: {
          ...ticketDisplay(ticket),
          checkedInAt: prevMeta.previousCheckInAt ?? ticket.checkedInAt,
        },
      };
    }

    if (ticket.status !== TicketStatus.VALID) {
      await tx.checkIn.create({
        data: {
          ticketId: ticket.id,
          eventId: input.eventId,
          result: CheckInResult.INVALID,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          isManual: input.isManual,
        },
      });
      return {
        result: CheckInResult.INVALID,
        message: "UGYLDIG BILLETT",
      };
    }

    assertTicketTransition(ticket.status, TicketStatus.CHECKED_IN);

    const now = new Date();
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: TicketStatus.CHECKED_IN, checkedInAt: now },
    });

    await tx.checkIn.create({
      data: {
        ticketId: ticket.id,
        eventId: input.eventId,
        result: CheckInResult.SUCCESS,
        checkedInBy: input.checkedInBy,
        deviceId: input.deviceId,
        isManual: input.isManual,
        note: input.note,
        checkedInAt: now,
      },
    });

    if (input.isManual && input.checkedInBy) {
      await writeAuditLog({
        actorId: input.checkedInBy,
        action: "MANUAL_CHECKIN",
        entityType: "Ticket",
        entityId: ticket.id,
        organizationId: ticket.event.organizationId,
        metadata: {
          eventId: input.eventId,
          deviceId: input.deviceId,
          reason: input.note ?? null,
        },
      });
    }

    return {
      result: CheckInResult.SUCCESS,
      message: "GYLDIG",
      ticket: {
        ...ticketDisplay(ticket),
        checkedInAt: now,
      },
    };
  }

  static async checkInByTicketId(input: {
    ticketId: string;
    eventId: string;
    checkedInBy?: string;
    deviceId?: string;
    note?: string;
    forceOverride?: boolean;
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
      return this.admitLockedTicket(tx, {
        ticketId: input.ticketId,
        eventId: input.eventId,
        checkedInBy: input.checkedInBy,
        deviceId: input.deviceId,
        isManual: true,
        note: input.note,
        forceOverride: input.forceOverride,
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
