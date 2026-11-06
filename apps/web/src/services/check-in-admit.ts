import {
  CheckInResult,
  EventStatus,
  TicketStatus,
  type Prisma,
} from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { assertTicketTransition } from "@/services/ticket-state-machine";
import {
  type CheckInResponse,
  type CheckInEventAccess,
  ticketDisplay,
  previousFromCheckIn,
  ticketInclude,
} from "@/services/check-in-shared";

export async function admitLockedTicket(
  tx: Prisma.TransactionClient,
  input: {
    ticketId: string;
    eventId: string;
    checkedInBy?: string;
    deviceId?: string;
    isManual: boolean;
    note?: string;
    forceOverride?: boolean;
    eventAccess?: CheckInEventAccess;
    /** Original scanner-selected event (before any retarget). */
    selectedEventId?: string;
  }
): Promise<CheckInResponse> {
  const ticket = await tx.ticket.findUniqueOrThrow({
    where: { id: input.ticketId },
    include: ticketInclude,
  });
  let eventId = input.eventId;
  let retargeted = false;
  if (ticket.eventId !== eventId) {
    const ticketEvent = {
      id: ticket.event.id,
      organizationId: ticket.event.organizationId,
      name: ticket.event.name,
    };
    if (input.eventAccess?.canAccessEvent(ticketEvent)) {
      // Selected scanner event ≠ ticket event, but staff is allowed to scan
      // the ticket's event — continue admission against the ticket event.
      eventId = ticket.eventId;
      retargeted = true;
    } else {
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
        // Genuine mismatch the scanner cannot admit — keep short door message.
        message: "FEIL ARRANGEMENT",
        ticket: ticketDisplay(ticket),
      };
    }
  }
  const resolvedMeta = retargeted
    ? {
        resolvedEventId: eventId,
        resolvedEventName: ticket.event.name,
      }
    : {};
  if (ticket.event.status === EventStatus.CANCELLED) {
    await tx.checkIn.create({
      data: {
        ticketId: ticket.id,
        eventId,
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
      ...resolvedMeta,
    };
  }
  if (ticket.status === TicketStatus.TRANSFERRED) {
    await tx.checkIn.create({
      data: {
        ticketId: ticket.id,
        eventId,
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
      ...resolvedMeta,
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
        eventId,
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
      ...resolvedMeta,
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
          eventId,
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
            eventId,
            deviceId: input.deviceId,
            reason: input.note ?? null,
            previousCheckInAt: prevMeta.previousCheckInAt?.toISOString() ?? null,
            retargetedFrom: input.selectedEventId ?? null,
          },
        });
      }
      return {
        result: CheckInResult.SUCCESS,
        message: "GYLDIG",
        ticket: { ...ticketDisplay(ticket), checkedInAt: now },
        ...prevMeta,
        ...resolvedMeta,
      };
    }
    await tx.checkIn.create({
      data: {
        ticketId: ticket.id,
        eventId,
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
      ...resolvedMeta,
    };
  }
  if (ticket.status !== TicketStatus.VALID) {
    await tx.checkIn.create({
      data: {
        ticketId: ticket.id,
        eventId,
        result: CheckInResult.INVALID,
        checkedInBy: input.checkedInBy,
        deviceId: input.deviceId,
        isManual: input.isManual,
      },
    });
    return {
      result: CheckInResult.INVALID,
      message: "UGYLDIG BILLETT",
      ...resolvedMeta,
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
      eventId,
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
        eventId,
        deviceId: input.deviceId,
        reason: input.note ?? null,
        retargetedFrom: input.selectedEventId ?? null,
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
    ...resolvedMeta,
  };
}
