import { describe, expect, it } from "vitest";
import {
  DiscountType,
  PaymentStatus,
  ServiceFeeMode,
  TicketQrMode,
  TicketStatus,
  type Event,
  type Organization,
  type PromoCode,
} from "@prisma/client";
import {
  buildPromoterShortPath,
  buildPromoterTrackingPath,
  buildPromoterTrackingUrl,
  normalizePromoterCode,
  readRefFromSearchParams,
} from "@/lib/promoter";
import { softResolvePromoApplicability } from "@/services/promo-service";
import { applyPromo, calculatePricing } from "@/services/order-service";
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

function mockOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org_1",
    name: "Titan",
    slug: "titan",
    description: null,
    logoUrl: null,
    website: null,
    isActive: true,
    allowRefunds: true,
    defaultServiceFee: 2000,
    defaultServiceFeeMode: ServiceFeeMode.ON_TOP,
    defaultCurrency: "NOK",
    legalName: "Titan Events AS",
    organizationNumber: "999999999",
    legalAddress: null,
    legalPostalCode: null,
    legalCity: null,
    legalCountry: "NO",
    contactEmail: null,
    customerServiceEmail: null,
    customerServicePhone: null,
    vatRegistrationStatus: "REGISTERED",
    termsVersion: "1.0",
    refundPolicyType: "ORGANIZER_REFUND_POLICY",
    refundPolicyText: null,
    settlementConfig: null,
    stripeConnectedAccountId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockEvent(overrides: Partial<Event> = {}): Event {
  const now = new Date();
  return {
    id: "evt_1",
    organizationId: "org_1",
    sellerOrganizationId: "org_1",
    venueId: null,
    name: "Friday Night",
    slug: "friday-night",
    description: null,
    shortDescription: null,
    address: null,
    postalCode: null,
    city: "Oslo",
    country: "NO",
    timezone: "Europe/Oslo",
    startsAt: now,
    endsAt: now,
    doorsOpenAt: null,
    ageLimit: 20,
    coverImageUrl: null,
    capacity: 500,
    status: "PUBLISHED",
    visibility: "PUBLIC",
    category: null,
    salesStartAt: null,
    salesEndAt: null,
    publishAt: null,
    salesPausedAt: null,
    availabilityDisplay: "SHOW_LOW_STOCK_ONLY",
    lowStockThreshold: 10,
    soldOutDisplay: "SOLD_OUT",
    allowTransfer: true,
    qrMode: TicketQrMode.STATIC_QR,
    dynamicQrTtlSeconds: 30,
    serviceFee: 2000,
    serviceFeeMode: ServiceFeeMode.ON_TOP,
    currency: "NOK",
    refundPolicyType: null,
    refundPolicyText: null,
    termsVersion: null,
    waitlistEnabled: false,
    waitlistOnReleaseSoldOut: false,
    reminder24hEnabled: true,
    reminder3hEnabled: false,
    seriesId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Event;
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

describe("TRACKING never discounts", () => {
  it("applyPromo returns 0 for TRACKING even when discountValue is non-zero", () => {
    const trackingWithFakeDiscount = basePromo({
      discountType: DiscountType.PERCENTAGE,
      discountValue: 5000, // 50% — must be ignored
    });
    expect(applyPromo(trackingWithFakeDiscount, 100_000)).toBe(0);

    const trackingFixed = basePromo({
      discountType: DiscountType.FIXED,
      discountValue: 50_000,
    });
    expect(applyPromo(trackingFixed, 100_000)).toBe(0);
  });

  it("DISCOUNT promos still apply percentage/fixed discounts", () => {
    expect(
      applyPromo(
        basePromo({
          kind: "DISCOUNT",
          discountType: DiscountType.PERCENTAGE,
          discountValue: 2000,
        }),
        100_000
      )
    ).toBe(20_000);
    expect(
      applyPromo(
        basePromo({
          kind: "DISCOUNT",
          discountType: DiscountType.FIXED,
          discountValue: 15_000,
        }),
        100_000
      )
    ).toBe(15_000);
  });

  it("checkout total identical with vs without TRACKING ref", () => {
    const now = new Date();
    const ticketTypes = [
      {
        id: "tt_1",
        eventId: "evt_1",
        name: "Standard",
        description: null,
        price: 25_000,
        vatRate: 2500,
        taxTreatmentId: null,
        serviceFeeTaxTreatmentId: null,
        quantityTotal: 100,
        quantityReleased: 50,
        quantitySold: 0,
        quantityReserved: 0,
        maxPerOrder: 4,
        minPerOrder: 1,
        salesStartAt: null,
        salesEndAt: null,
        salesPausedAt: null,
        isVisible: true,
        isPubliclyPurchasable: true,
        releaseMode: "MANUAL" as const,
        admissionCount: 1,
        isBundle: false,
        sortOrder: 0,
        serviceFee: null,
        createdAt: now,
        updatedAt: now,
        priceTiers: [],
      },
    ];
    const items = [{ ticketTypeId: "tt_1", quantity: 2 }];

    const withoutRef = calculatePricing({
      organization: mockOrg(),
      event: mockEvent(),
      ticketTypes,
      items,
      promo: null,
    });
    const withTrackingRef = calculatePricing({
      organization: mockOrg(),
      event: mockEvent(),
      ticketTypes,
      items,
      promo: basePromo({
        discountType: DiscountType.PERCENTAGE,
        discountValue: 5000,
      }),
    });

    expect(withTrackingRef.discount).toBe(0);
    expect(withTrackingRef.subtotal).toBe(withoutRef.subtotal);
    expect(withTrackingRef.serviceFee).toBe(withoutRef.serviceFee);
    expect(withTrackingRef.total).toBe(withoutRef.total);
    expect(withTrackingRef.promoCodeId).toBe("promo_1");
    expect(withoutRef.promoCodeId).toBeUndefined();
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
