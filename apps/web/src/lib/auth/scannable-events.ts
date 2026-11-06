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

type TimedEvent = { startsAt: Date; endsAt: Date };

/**
 * Prefer the event staff are most likely scanning right now:
 * 1) currently in progress, 2) soonest upcoming, 3) most recently ended.
 *
 * Avoids defaulting to the oldest COMPLETED event (startsAt asc + take N),
 * which caused «FEIL ARRANGEMENT» when tickets belonged to tonight's event.
 */
export function pickPreferredScanEvent<T extends TimedEvent>(
  events: T[],
  now = new Date()
): T | undefined {
  if (events.length === 0) return undefined;
  if (events.length === 1) return events[0];

  const t = now.getTime();
  const live = events
    .filter((e) => e.startsAt.getTime() <= t && e.endsAt.getTime() >= t)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (live[0]) return live[0];

  const upcoming = events
    .filter((e) => e.startsAt.getTime() > t)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (upcoming[0]) return upcoming[0];

  return [...events].sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
}

/** Pick explicit ?event= when present, otherwise the preferred live/upcoming event. */
export function selectScannerEvent<T extends TimedEvent & { id: string; slug?: string }>(
  accessible: T[],
  requested?: string | null
): T | undefined {
  if (accessible.length === 0) return undefined;
  if (accessible.length === 1) return accessible[0];
  if (requested) {
    const match = accessible.find(
      (e) => e.id === requested || e.slug === requested
    );
    if (match) return match;
  }
  return pickPreferredScanEvent(accessible);
}
