import { describe, expect, it } from "vitest";
import {
  canNavigateTickets,
  clampTicketIndex,
  nextTicketIndex,
  prevTicketIndex,
  ticketPositionLabel,
} from "@/lib/tickets/ticket-carousel-nav";
import {
  getTicketStatusPresentation,
  isQrDisabled,
} from "@/lib/tickets/ticket-status";

describe("ticket carousel navigation", () => {
  it("clamps index for 1–5 ticket orders", () => {
    for (const count of [1, 2, 3, 5]) {
      expect(clampTicketIndex(-1, count)).toBe(0);
      expect(clampTicketIndex(0, count)).toBe(0);
      expect(clampTicketIndex(count - 1, count)).toBe(count - 1);
      expect(clampTicketIndex(count + 5, count)).toBe(count - 1);
      expect(ticketPositionLabel(0, count)).toBe(`Billett 1 av ${count}`);
      expect(ticketPositionLabel(count - 1, count)).toBe(`Billett ${count} av ${count}`);
    }
  });

  it("wraps prev/next for multi-ticket orders without collapsing count", () => {
    expect(canNavigateTickets(1)).toBe(false);
    expect(canNavigateTickets(2)).toBe(true);

    expect(nextTicketIndex(0, 2)).toBe(1);
    expect(nextTicketIndex(1, 2)).toBe(0);
    expect(prevTicketIndex(0, 2)).toBe(1);

    expect(nextTicketIndex(2, 3)).toBe(0);
    expect(prevTicketIndex(0, 3)).toBe(2);

    const visited = new Set<number>();
    let i = 0;
    for (let step = 0; step < 5; step++) {
      visited.add(i);
      i = nextTicketIndex(i, 5);
    }
    expect(visited.size).toBe(5);
  });

  it("handles empty ticket lists safely", () => {
    expect(clampTicketIndex(3, 0)).toBe(0);
    expect(nextTicketIndex(0, 0)).toBe(0);
    expect(prevTicketIndex(0, 0)).toBe(0);
    expect(ticketPositionLabel(0, 0)).toBe("Billett 0 av 0");
    expect(canNavigateTickets(0)).toBe(false);
  });
});

describe("ticket status presentation", () => {
  it("exposes clear customer labels and QR rules", () => {
    expect(getTicketStatusPresentation("VALID").label).toBe("Gyldig");
    expect(getTicketStatusPresentation("CHECKED_IN").label).toBe("Brukt");
    expect(getTicketStatusPresentation("CANCELLED").label).toBe("Kansellert");
    expect(getTicketStatusPresentation("TRANSFERRED").label).toBe("Overført");
    expect(getTicketStatusPresentation("REFUNDED").label).toBe("Refundert");

    expect(isQrDisabled("VALID")).toBe(false);
    expect(isQrDisabled("CHECKED_IN")).toBe(true);
    expect(isQrDisabled("REFUNDED")).toBe(true);
    expect(isQrDisabled("CANCELLED")).toBe(true);
    expect(isQrDisabled("TRANSFERRED")).toBe(true);
  });
});
