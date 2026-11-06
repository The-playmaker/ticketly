import { CheckInResult } from "@prisma/client";

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
  /** Present on WRONG_EVENT when the ticket belongs to another known event. */
  suggestedEventId?: string;
  suggestedEventName?: string;
  /** Set when check-in was auto-retargeted to the ticket's event. */
  resolvedEventId?: string;
  resolvedEventName?: string;
};

export type CheckInEventAccess = {
  /**
   * Return true when the scanning user may admit tickets for this event
   * (org scan role + EventAssignment). Used to auto-retarget a mismatched
   * selected scanner event instead of hard-failing «FEIL ARRANGEMENT».
   */
  canAccessEvent: (event: {
    id: string;
    organizationId: string;
    name: string;
  }) => boolean;
};

export function ticketDisplay(ticket: {
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

export function previousFromCheckIn(
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

export const ticketInclude = {
  ticketType: true,
  event: true,
  checkIns: {
    where: { result: CheckInResult.SUCCESS },
    orderBy: { checkedInAt: "desc" as const },
    take: 1,
    include: { staff: { select: { name: true } } },
  },
};
