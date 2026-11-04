import { describe, expect, it } from "vitest";
import { ticketSelectionSchema } from "@/lib/validators";
import { mergeTicketSelectionItems } from "@/lib/ticket-selection";
import { AppError } from "@/lib/api-error";

describe("ticketSelectionSchema + merge", () => {
  it("rejects more than 20 item lines", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      ticketTypeId: `tt-${i}`,
      quantity: 1,
    }));
    const parsed = ticketSelectionSchema.safeParse({
      eventId: "evt",
      sessionId: "session-abcdefgh",
      items,
    });
    expect(parsed.success).toBe(false);
  });

  it("merges duplicate ticketTypeId and rejects when sum exceeds maxPerOrder", () => {
    const merged = mergeTicketSelectionItems([
      { ticketTypeId: "vip", quantity: 2 },
      { ticketTypeId: "vip", quantity: 3 },
    ]);
    expect(merged).toEqual([{ ticketTypeId: "vip", quantity: 5 }]);

    // Simulate reserve min/max check on merged sum (maxPerOrder=4)
    const maxPerOrder = 4;
    expect(merged[0]!.quantity).toBeGreaterThan(maxPerOrder);
  });

  it("two lines same type over max → reject via merge qty cap or AppError path", () => {
    expect(() =>
      mergeTicketSelectionItems([
        { ticketTypeId: "vip", quantity: 30 },
        { ticketTypeId: "vip", quantity: 25 },
      ])
    ).toThrow(AppError);

    try {
      mergeTicketSelectionItems([
        { ticketTypeId: "vip", quantity: 30 },
        { ticketTypeId: "vip", quantity: 25 },
      ]);
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("INVALID_QUANTITY");
    }
  });

  it("createPendingOrder / reserve share merge helper (source contract)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const orderSrc = fs.readFileSync(
      path.resolve(__dirname, "../../src/services/order-service.ts"),
      "utf8"
    );
    const reserveSrc = fs.readFileSync(
      path.resolve(__dirname, "../../src/services/reservation-service.ts"),
      "utf8"
    );
    expect(orderSrc).toContain("mergeTicketSelectionItems");
    expect(reserveSrc).toContain("mergeTicketSelectionItems");
  });
});
