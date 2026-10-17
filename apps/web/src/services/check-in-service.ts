import {
  CheckInResult,
  EventStatus,
  TicketStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { hashTicketToken } from "@/lib/tickets/token";
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

export class CheckInService {
  /**
   * Atomic check-in: validates token by hash (legacy secureToken fallback)
   * and ensures two scanners cannot approve the same ticket concurrently.
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
        return { result: CheckInResult.INVALID, message: "SCANNER DEAKTIVERT" };
      }
      throw e;
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

      const ticket = await tx.ticket.findUniqueOrThrow({
        where: { id: rows[0].id },
        include: {
          ticketType: true,
          event: true,
          checkIns: {
            where: { result: CheckInResult.SUCCESS },
            orderBy: { checkedInAt: "desc" },
            take: 1,
          },
        },
      });

      if (ticket.eventId !== input.eventId) {
        await tx.checkIn.create({
          data: {
            ticketId: ticket.id,
            eventId: input.eventId,
            result: CheckInResult.WRONG_EVENT,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            isManual: input.isManual ?? false,
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
            isManual: input.isManual ?? false,
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
            isManual: input.isManual ?? false,
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
            isManual: input.isManual ?? false,
          },
        });
        return {
          result,
          message: ticket.status === TicketStatus.REFUNDED ? "REFUNDERT" : "KANSELLERT",
          ticket: ticketDisplay(ticket),
        };
      }

      if (ticket.status === TicketStatus.CHECKED_IN) {
        const prev = ticket.checkIns[0]?.checkedInAt ?? ticket.checkedInAt;
        await tx.checkIn.create({
          data: {
            ticketId: ticket.id,
            eventId: input.eventId,
            result: CheckInResult.ALREADY_USED,
            checkedInBy: input.checkedInBy,
            deviceId: input.deviceId,
            isManual: input.isManual ?? false,
          },
        });
        return {
          result: CheckInResult.ALREADY_USED,
          message: "ALLEREDE BRUKT",
          previousCheckInAt: prev,
          ticket: {
            ...ticketDisplay(ticket),
            checkedInAt: prev,
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
            isManual: input.isManual ?? false,
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
          isManual: input.isManual ?? false,
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
          metadata: { eventId: input.eventId, deviceId: input.deviceId },
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
    });
  }

  static async checkInByTicketId(input: {
    ticketId: string;
    eventId: string;
    checkedInBy?: string;
    deviceId?: string;
    note?: string;
  }) {
    const ticket = await prisma.ticket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) {
      return { result: CheckInResult.INVALID, message: "UGYLDIG BILLETT" } satisfies CheckInResponse;
    }

    // Manual check-in by ticket id — lock and transition without requiring raw QR token
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${input.ticketId} FOR UPDATE`;
      const locked = await tx.ticket.findUniqueOrThrow({
        where: { id: input.ticketId },
        include: {
          ticketType: true,
          event: true,
          checkIns: {
            where: { result: CheckInResult.SUCCESS },
            orderBy: { checkedInAt: "desc" },
            take: 1,
          },
        },
      });

      if (locked.eventId !== input.eventId) {
        return {
          result: CheckInResult.WRONG_EVENT,
          message: "FEIL ARRANGEMENT",
          ticket: ticketDisplay(locked),
        };
      }
      if (locked.event.status === EventStatus.CANCELLED) {
        return {
          result: CheckInResult.EVENT_CANCELLED,
          message: "KANSELLERT",
          ticket: ticketDisplay(locked),
        };
      }
      if (locked.status === TicketStatus.TRANSFERRED) {
        return {
          result: CheckInResult.INVALID,
          message: "OVERFØRT",
          ticket: ticketDisplay(locked),
        };
      }
      if (locked.status === TicketStatus.REFUNDED) {
        return {
          result: CheckInResult.REFUNDED,
          message: "REFUNDERT",
          ticket: ticketDisplay(locked),
        };
      }
      if (locked.status === TicketStatus.CANCELLED) {
        return {
          result: CheckInResult.CANCELLED,
          message: "KANSELLERT",
          ticket: ticketDisplay(locked),
        };
      }
      if (locked.status === TicketStatus.CHECKED_IN) {
        const prev = locked.checkIns[0]?.checkedInAt ?? locked.checkedInAt;
        return {
          result: CheckInResult.ALREADY_USED,
          message: "ALLEREDE BRUKT",
          previousCheckInAt: prev,
          ticket: { ...ticketDisplay(locked), checkedInAt: prev },
        };
      }
      if (locked.status !== TicketStatus.VALID) {
        return { result: CheckInResult.INVALID, message: "UGYLDIG" };
      }

      assertTicketTransition(locked.status, TicketStatus.CHECKED_IN);
      const now = new Date();
      await tx.ticket.update({
        where: { id: locked.id },
        data: { status: TicketStatus.CHECKED_IN, checkedInAt: now },
      });
      await tx.checkIn.create({
        data: {
          ticketId: locked.id,
          eventId: input.eventId,
          result: CheckInResult.SUCCESS,
          checkedInBy: input.checkedInBy,
          deviceId: input.deviceId,
          isManual: true,
          note: input.note,
          checkedInAt: now,
        },
      });

      if (input.checkedInBy) {
        await writeAuditLog({
          actorId: input.checkedInBy,
          action: "MANUAL_CHECKIN",
          entityType: "Ticket",
          entityId: input.ticketId,
          organizationId: locked.event.organizationId,
          metadata: { result: CheckInResult.SUCCESS, eventId: input.eventId },
        });
      }

      return {
        result: CheckInResult.SUCCESS,
        message: "GYLDIG",
        ticket: { ...ticketDisplay(locked), checkedInAt: now },
      };
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
