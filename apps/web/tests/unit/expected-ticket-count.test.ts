import { describe, expect, it } from "vitest";
import { expectedTicketCountForItems } from "@/lib/tickets/expected-count";

describe("expectedTicketCountForItems", () => {
  it("sums quantity × admissionCount", () => {
    expect(
      expectedTicketCountForItems([
        { quantity: 1, admissionCount: 1 },
        { quantity: 2, admissionCount: 4 },
      ])
    ).toBe(1 + 8);
  });

  it("treats missing/zero admissionCount as 1", () => {
    expect(expectedTicketCountForItems([{ quantity: 3, admissionCount: null }])).toBe(3);
    expect(expectedTicketCountForItems([{ quantity: 2, admissionCount: 0 }])).toBe(2);
  });
});
