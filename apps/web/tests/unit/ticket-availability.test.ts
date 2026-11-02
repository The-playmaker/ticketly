import { describe, expect, it } from "vitest";
import {
  availabilityFromErrorCode,
  BUSINESS_AVAILABILITY_ERROR_CODES,
  inventoryHint,
  resolveEventAvailability,
  resolveTicketAvailability,
  technicalErrorPresentation,
} from "@/lib/tickets/ticket-availability";

const baseEvent = {
  status: "PUBLISHED",
  salesStartAt: null,
  salesEndAt: null,
  salesPausedAt: null,
  soldOutDisplay: "SOLD_OUT" as const,
  timezone: "Europe/Oslo",
};

const baseType = {
  available: 10,
  salesStartAt: null,
  salesEndAt: null,
  salesPausedAt: null,
  isPubliclyPurchasable: true,
  isVisible: true,
};

const now = new Date("2026-06-15T12:00:00.000Z");

describe("resolveTicketAvailability", () => {
  it("marks purchasable when inventory and windows allow", () => {
    const status = resolveTicketAvailability(baseEvent, baseType, now);
    expect(status.kind).toBe("available");
    expect(status.purchasable).toBe(true);
  });

  it("sales ended — event window", () => {
    const status = resolveTicketAvailability(
      { ...baseEvent, salesEndAt: "2026-06-01T00:00:00.000Z" },
      baseType,
      now
    );
    expect(status).toMatchObject({
      kind: "sales_ended",
      purchasable: false,
      heading: "Billettsalget er avsluttet",
      description: "Salget av denne billettypen er ikke lenger tilgjengelig.",
      tone: "neutral",
    });
  });

  it("sales ended — ticket type window (other types may still sell)", () => {
    const status = resolveTicketAvailability(
      baseEvent,
      { ...baseType, salesEndAt: "2026-05-01T00:00:00.000Z" },
      now
    );
    expect(status.kind).toBe("sales_ended");
    expect(status.purchasable).toBe(false);
  });

  it("sold out is distinct from sales ended", () => {
    const soldOut = resolveTicketAvailability(baseEvent, { ...baseType, available: 0 }, now);
    const ended = resolveTicketAvailability(
      { ...baseEvent, salesEndAt: "2026-01-01T00:00:00.000Z" },
      { ...baseType, available: 0 },
      now
    );
    expect(soldOut.kind).toBe("sold_out");
    expect(soldOut.heading).toBe("Utsolgt");
    expect(soldOut.description).toBe("Denne billettypen er dessverre utsolgt.");
    expect(ended.kind).toBe("sales_ended");
    expect(ended.heading).not.toBe(soldOut.heading);
  });

  it("sales not yet open includes formatted date/time", () => {
    const opens = new Date("2026-07-01T10:00:00.000Z");
    const status = resolveTicketAvailability(
      { ...baseEvent, salesStartAt: opens },
      baseType,
      now
    );
    expect(status.kind).toBe("sales_not_open");
    expect(status.heading).toBe("Billettsalget åpner snart");
    expect(status.description).toMatch(/Salget åpner .+ kl\. \d{2}:\d{2}\./);
    expect(status.opensAt).toBe(opens.toISOString());
    expect(status.purchasable).toBe(false);
  });

  it("temporarily unavailable for event pause / PAUSED status", () => {
    const pausedAt = resolveTicketAvailability(
      { ...baseEvent, salesPausedAt: "2026-06-14T00:00:00.000Z" },
      baseType,
      now
    );
    const pausedStatus = resolveTicketAvailability(
      { ...baseEvent, status: "PAUSED" },
      baseType,
      now
    );
    for (const status of [pausedAt, pausedStatus]) {
      expect(status.kind).toBe("temporarily_unavailable");
      expect(status.heading).toBe("Billettsalget er midlertidig utilgjengelig");
      expect(status.description).toBe(
        "Vi kan for øyeblikket ikke tilby billettkjøp. Prøv igjen senere."
      );
      expect(status.tone).toBe("neutral");
      expect(status.purchasable).toBe(false);
    }
  });

  it("ticket-type pause blocks only that type", () => {
    const status = resolveTicketAvailability(
      baseEvent,
      { ...baseType, salesPausedAt: "2026-06-14T00:00:00.000Z" },
      now
    );
    expect(status.kind).toBe("temporarily_unavailable");
  });

  it("MORE_COMING sold-out display uses more_coming, not error tone", () => {
    const status = resolveTicketAvailability(
      { ...baseEvent, soldOutDisplay: "MORE_COMING" },
      { ...baseType, available: 0 },
      now
    );
    expect(status.kind).toBe("more_coming");
    expect(status.tone).toBe("neutral");
  });

  it("PAUSED sold-out display maps to temporarily unavailable", () => {
    const status = resolveTicketAvailability(
      { ...baseEvent, soldOutDisplay: "PAUSED" },
      { ...baseType, available: 0 },
      now
    );
    expect(status.kind).toBe("temporarily_unavailable");
  });

  it("event sales window takes precedence over type inventory", () => {
    const status = resolveTicketAvailability(
      { ...baseEvent, salesEndAt: "2026-01-01T00:00:00.000Z" },
      { ...baseType, available: 50 },
      now
    );
    expect(status.kind).toBe("sales_ended");
  });

  it("COMPLETED event is sales ended; CANCELLED is temporarily unavailable", () => {
    expect(
      resolveTicketAvailability({ ...baseEvent, status: "COMPLETED" }, baseType, now).kind
    ).toBe("sales_ended");
    expect(
      resolveTicketAvailability({ ...baseEvent, status: "CANCELLED" }, baseType, now).kind
    ).toBe("temporarily_unavailable");
  });
});

describe("resolveEventAvailability", () => {
  it("stays available when at least one type is purchasable", () => {
    const status = resolveEventAvailability(
      baseEvent,
      [
        { ...baseType, available: 0 },
        { ...baseType, available: 5 },
      ],
      now
    );
    expect(status.purchasable).toBe(true);
    expect(status.kind).toBe("available");
  });

  it("prefers temporarily unavailable over sold out when mixed blockers", () => {
    const status = resolveEventAvailability(
      { ...baseEvent, salesPausedAt: "2026-06-14T00:00:00.000Z" },
      [
        { ...baseType, available: 0 },
        { ...baseType, available: 0 },
      ],
      now
    );
    expect(status.kind).toBe("temporarily_unavailable");
  });

  it("aggregates to sold_out when every type is sold out", () => {
    const status = resolveEventAvailability(
      baseEvent,
      [
        { ...baseType, available: 0 },
        { ...baseType, available: 0 },
      ],
      now
    );
    expect(status.kind).toBe("sold_out");
  });
});

describe("availabilityFromErrorCode + technical errors", () => {
  it("maps business API codes without error tone", () => {
    expect(availabilityFromErrorCode("SALES_ENDED")?.kind).toBe("sales_ended");
    expect(availabilityFromErrorCode("TICKET_SOLD_OUT")?.kind).toBe("sold_out");
    expect(availabilityFromErrorCode("SALES_PAUSED")?.kind).toBe("temporarily_unavailable");
    expect(availabilityFromErrorCode("SALES_NOT_STARTED")?.kind).toBe("sales_not_open");
    expect(availabilityFromErrorCode("SALES_ENDED")?.tone).toBe("neutral");
  });

  it("returns null for unknown codes so callers can use technical error", () => {
    expect(availabilityFromErrorCode("STRIPE_CARD_DECLINED")).toBeNull();
  });

  it("technicalErrorPresentation is the only error-tone path", () => {
    const tech = technicalErrorPresentation();
    expect(tech).toMatchObject({
      kind: "technical_error",
      heading: "Noe gikk galt",
      description: "Vi kunne ikke fullføre forespørselen. Prøv igjen.",
      tone: "error",
      purchasable: false,
    });
  });

  it("known business codes set is complete for reserve gates", () => {
    for (const code of [
      "SALES_ENDED",
      "SALES_NOT_STARTED",
      "SALES_PAUSED",
      "TICKET_SOLD_OUT",
      "EVENT_NOT_ON_SALE",
      "EVENT_CANCELLED",
    ]) {
      expect(BUSINESS_AVAILABILITY_ERROR_CODES.has(code)).toBe(true);
    }
  });
});

describe("inventoryHint", () => {
  it("respects HIDE / SHOW_EXACT / low-stock threshold", () => {
    expect(inventoryHint(3, { availabilityDisplay: "HIDE" })).toBeNull();
    expect(inventoryHint(12, { availabilityDisplay: "SHOW_EXACT" })).toBe("12 igjen");
    expect(inventoryHint(4, { availabilityDisplay: "SHOW_LOW_STOCK_ONLY", lowStockThreshold: 10 })).toBe(
      "Få igjen"
    );
    expect(inventoryHint(8, { availabilityDisplay: "SHOW_LOW_STOCK_ONLY", lowStockThreshold: 10 })).toBe(
      "8 igjen"
    );
    expect(inventoryHint(50, { availabilityDisplay: "SHOW_LOW_STOCK_ONLY", lowStockThreshold: 10 })).toBeNull();
  });
});

describe("purchase eligibility transitions", () => {
  it("transitions not_open → available → sold_out → sales_ended", () => {
    const opens = new Date("2026-06-20T10:00:00.000Z");
    const ends = new Date("2026-06-30T22:00:00.000Z");
    const event = {
      ...baseEvent,
      salesStartAt: opens,
      salesEndAt: ends,
    };

    expect(resolveTicketAvailability(event, baseType, new Date("2026-06-10T12:00:00Z")).kind).toBe(
      "sales_not_open"
    );
    expect(resolveTicketAvailability(event, baseType, new Date("2026-06-21T12:00:00Z")).kind).toBe(
      "available"
    );
    expect(
      resolveTicketAvailability(event, { ...baseType, available: 0 }, new Date("2026-06-21T12:00:00Z"))
        .kind
    ).toBe("sold_out");
    expect(resolveTicketAvailability(event, baseType, new Date("2026-07-01T12:00:00Z")).kind).toBe(
      "sales_ended"
    );
  });
});
