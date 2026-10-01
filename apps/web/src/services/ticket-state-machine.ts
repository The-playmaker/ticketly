import { TicketStatus } from "@prisma/client";

/**
 * Explicit ticket lifecycle. Illegal transitions throw.
 *
 * VALID → CHECKED_IN | REFUNDED | CANCELLED | TRANSFERRED
 * CHECKED_IN → REFUNDED | CANCELLED (business may allow post-entry refund)
 * TRANSFERRED → (old ticket becomes TRANSFERRED; new token on same row stays VALID)
 * CANCELLED / REFUNDED → terminal (no return to VALID without admin reversal — not implemented)
 */
const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.RESERVED]: [TicketStatus.VALID, TicketStatus.CANCELLED],
  [TicketStatus.VALID]: [
    TicketStatus.CHECKED_IN,
    TicketStatus.REFUNDED,
    TicketStatus.CANCELLED,
    TicketStatus.TRANSFERRED,
  ],
  [TicketStatus.CHECKED_IN]: [TicketStatus.REFUNDED, TicketStatus.CANCELLED],
  [TicketStatus.TRANSFERRED]: [TicketStatus.CANCELLED, TicketStatus.REFUNDED],
  [TicketStatus.CANCELLED]: [],
  [TicketStatus.REFUNDED]: [],
};

export class IllegalTicketTransitionError extends Error {
  constructor(from: TicketStatus, to: TicketStatus) {
    super(`Illegal ticket transition ${from} → ${to}`);
    this.name = "IllegalTicketTransitionError";
  }
}

export function assertTicketTransition(from: TicketStatus, to: TicketStatus) {
  if (from === to) return;
  if (!ALLOWED[from]?.includes(to)) {
    throw new IllegalTicketTransitionError(from, to);
  }
}

export function isTerminalTicketStatus(status: TicketStatus) {
  return status === TicketStatus.CANCELLED || status === TicketStatus.REFUNDED;
}
