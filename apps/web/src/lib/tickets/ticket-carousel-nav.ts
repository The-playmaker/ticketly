/** Pure helpers for single-ticket carousel navigation. */

export function clampTicketIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

export function nextTicketIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return (clampTicketIndex(index, count) + 1) % count;
}

export function prevTicketIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  const current = clampTicketIndex(index, count);
  return (current - 1 + count) % count;
}

/** Norwegian "Billett 1 av 2" style label (1-based). */
export function ticketPositionLabel(index: number, count: number): string {
  if (count <= 0) return "Billett 0 av 0";
  const n = clampTicketIndex(index, count) + 1;
  return `Billett ${n} av ${count}`;
}

export function canNavigateTickets(count: number): boolean {
  return count > 1;
}

/** Minimum horizontal swipe distance (px) to change ticket on touch devices. */
export const TICKET_SWIPE_THRESHOLD_PX = 48;
