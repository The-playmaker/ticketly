import { describe, expect, it } from "vitest";
import { DiscountType, PaymentStatus, TicketStatus, type PromoCode } from "@prisma/client";
import {
  buildPromoterShortPath,
  buildPromoterTrackingPath,
  buildPromoterTrackingUrl,
  normalizePromoterCode,
  readRefFromSearchParams,
} from "@/lib/promoter";
import { softResolvePromoApplicability } from "@/services/promo-service";
import {
  aggregateFinancialTotals,
  computeNetRevenue,
} from "@/lib/admin/event-financials";

function basePromo(overrides: Partial<PromoCode> = {}): PromoCode {
  return {
    id: "promo_1",
    organizationId: "org_1",
    eventId: "evt_1",
    ticketTypeId: null,
    code: "OLA20",
    label: "Ola Nordmann",
    kind: "TRACKING",
    discountType: DiscountType.PERCENTAGE,
    discountValue: 0,
    maxUses: null,
    usedCount: 0,
    startAt: null,
    expiresAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("promoter tracking helpers", () => {
  it("builds shareable event ref links", () => {
    expect(buildPromoterTrackingPath("oslo-night", "ola20")).toBe(
      "/events/oslo-night?ref=OLA20"
    );
    expect(buildPromoterTrackingUrl("https://ticketly.no/", "oslo-night", "ola20")).toBe(
      "https://ticketly.no/events/oslo-night?ref=OLA20"
    );
    expect(buildPromoterShortPath("ola20")).toBe("/p/OLA20");
    expect(normalizePromoterCode("  abc ")).toBe("ABC");
  });

  it("reads ref from search params (ref / promo / promoCode)", () => {
    expect(readRefFromSearchParams(new URLSearchParams("ref=ola20"))).toBe("OLA20");
    expect(readRefFromSearchParams(new URLSearchParams("promo=VIP"))).toBe("VIP");
    expect(readRefFromSearchParams(new URLSearchParams("promoCode=x"))).toBeNull();
    expect(readRefFromSearchParams(new URLSearchParams(""))).toBeNull();
  });
});

describe("soft promoter attribution", () => {
  it("keeps valid tracking promo", () => {
    const result = softResolvePromoApplicability(basePromo(), {
      eventId: "evt_1",
      ticketTypeIds: ["tt_1"],
    });
    expect(result.promo?.code).toBe("OLA20");
    expect(result.softSkipped).toBe(false);
  });

  it("soft-skips exhausted TRACKING promo (never blocks checkout)", () => {
    const result = softResolvePromoApplicability(
      basePromo({ maxUses: 1, usedCount: 1 }),
      { eventId: "evt_1", ticketTypeIds: ["tt_1"] }
    );
    expect(result.promo).toBeNull();
    expect(result.softSkipped).toBe(true);
    expect(result.reason).toBe("exhausted");
  });

  it("soft-skips expired TRACKING promo", () => {
    const result = softResolvePromoApplicability(
      basePromo({ expiresAt: new Date(Date.now() - 60_000) }),
      { eventId: "evt_1", ticketTypeIds: ["tt_1"] }
    );
    expect(result.promo).toBeNull();
    expect(result.softSkipped).toBe(true);
  });

  it("missing promo is a no-op", () => {
    const result = softResolvePromoApplicability(null, {
      eventId: "evt_1",
      ticketTypeIds: [],
    });
    expect(result.promo).toBeNull();
    expect(result.softSkipped).toBe(false);
  });

  it("DISCOUNT exhausted is not soft-skipped (hard error upstream)", () => {
    const result = softResolvePromoApplicability(
      basePromo({ kind: "DISCOUNT", discountValue: 1000, maxUses: 1, usedCount: 1 }),
      { eventId: "evt_1", ticketTypeIds: ["tt_1"] }
    );
    expect(result.softSkipped).toBe(false);
    expect(result.promo?.kind).toBe("DISCOUNT");
    expect(result.reason).toBe("exhausted");
  });
});

describe("promoter sales refund accounting", () => {
  const paidAt = new Date("2026-11-01T12:00:00Z");

  it("gross stays after refund; net uses computeNetRevenue", () => {
    const totals = aggregateFinancialTotals({
      orders: [
        { total: 50000, paidAt, paymentStatus: PaymentStatus.REFUNDED },
        { total: 30000, paidAt, paymentStatus: PaymentStatus.PAID },
      ],
      refunds: [{ amount: 50000, status: "SUCCEEDED" }],
      tickets: [
        { status: TicketStatus.REFUNDED },
        { status: TicketStatus.VALID },
        { status: TicketStatus.VALID },
      ],
    });
    expect(totals.paidOrderCount).toBe(2);
    expect(totals.grossSales).toBe(80000);
    expect(totals.successfulRefundAmount).toBe(50000);
    expect(totals.netRevenue).toBe(computeNetRevenue(80000, 50000));
    expect(totals.activeSoldTicketCount).toBe(2);
    expect(totals.refundedTicketCount).toBe(1);
  });

  it("pending refunds do not reduce net (only SUCCEEDED)", () => {
    const totals = aggregateFinancialTotals({
      orders: [{ total: 20000, paidAt, paymentStatus: PaymentStatus.PAID }],
      refunds: [{ amount: 20000, status: "PENDING" }],
      tickets: [{ status: TicketStatus.VALID }],
    });
    expect(totals.netRevenue).toBe(20000);
    expect(totals.successfulRefundAmount).toBe(0);
  });
});
