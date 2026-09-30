import {
  CheckInResult,
  EventStatus,
  TicketStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export type CheckInResponse = {
  result: CheckInResult;
  message: string;
  ticket?: {
    publicId: string;
    holderName: string | null;
    ticketType: string;
    checkedInAt?: Date | null;
  };
  previousCheckInAt?: Date | null;
};

export class CheckInService {
  /**
   * Atomic check-in: validates token server-side and ensures
   * two scanners cannot approve the same ticket concurrently.
   */
  static async checkInByToken(input: {
    token: string;
    eventId: string;
    checkedInBy?: string;
    deviceId?: string;
    isManual?: boolean;
    note?: string;
  }): Promise<CheckInResponse> {
    return prisma.$transaction(async (tx) => {
      // Lock ticket row
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Ticket" WHERE "secureToken" = ${input.token} FOR UPDATE
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
        include: { ticketType: true, event: true, checkIns: { where: { result: CheckInResult.SUCCESS }, orderBy: { checkedInAt: "desc" }, take: 1 } },
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
          ticket: {
            publicId: ticket.publicId,
            holderName: ticket.holderName,
            ticketType: ticket.ticketType.name,
          },
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
          message: "ARRANGEMENT KANSELLERT",
          ticket: {
            publicId: ticket.publicId,
            holderName: ticket.holderName,
            ticketType: ticket.ticketType.name,
          },
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
          message: ticket.status === TicketStatus.REFUNDED ? "REFUNDERT BILLETT" : "KANSELLERT BILLETT",
          ticket: {
            publicId: ticket.publicId,
            holderName: ticket.holderName,
            ticketType: ticket.ticketType.name,
          },
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
            publicId: ticket.publicId,
            holderName: ticket.holderName,
            ticketType: ticket.ticketType.name,
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

      return {
        result: CheckInResult.SUCCESS,
        message: "GYLDIG BILLETT",
        ticket: {
          publicId: ticket.publicId,
          holderName: ticket.holderName,
          ticketType: ticket.ticketType.name,
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

    const result = await this.checkInByToken({
      token: ticket.secureToken,
      eventId: input.eventId,
      checkedInBy: input.checkedInBy,
      deviceId: input.deviceId,
      isManual: true,
      note: input.note,
    });

    if (input.checkedInBy) {
      await writeAuditLog({
        actorId: input.checkedInBy,
        action: "CHECKIN_MANUAL_OVERRIDE",
        entityType: "Ticket",
        entityId: input.ticketId,
        metadata: { result: result.result, eventId: input.eventId },
      });
    }

    return result;
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
