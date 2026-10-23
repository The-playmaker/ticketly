import { EventStatus } from "@prisma/client";

/**
 * Event statuses eligible for door scanner / ticket validation.
 *
 * Pausing ticket sales (PAUSED) must NOT hide the event from scanners —
 * staff still need to validate tickets already sold.
 */
export const SCANNABLE_EVENT_STATUSES: EventStatus[] = [
  EventStatus.PUBLISHED,
  EventStatus.PAUSED,
  EventStatus.SOLD_OUT,
  EventStatus.COMPLETED,
];

export function isScannableEventStatus(
  status: EventStatus | string
): boolean {
  return (SCANNABLE_EVENT_STATUSES as string[]).includes(status);
}
