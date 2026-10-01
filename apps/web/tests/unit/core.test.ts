import { describe, expect, it } from "vitest";
import { applyPromo, calculatePricing } from "@/services/order-service";
import { getAvailableQuantity, resolveUnitPrice } from "@/services/reservation-service";
import {
  canScanTickets,
  canManageEvents,
  isSuperAdmin,
  type AuthUser,
} from "@/lib/auth/rbac";
import { generateSecureToken, generatePublicTicketId } from "@/lib/tickets/token";
import { GlobalRole, OrgRole, ServiceFeeMode, type Organization, type Event, type PromoCode } from "@prisma/client";

function mockOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org1",
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
    id: "evt1",
    organizationId: "org1",
    sellerOrganizationId: "org1",
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
    salesStartAt: null,
    salesEndAt: null,
    publishAt: null,
    allowTransfer: true,
    serviceFee: 2000,
    serviceFeeMode: ServiceFeeMode.ON_TOP,
    currency: "NOK",
    refundPolicyType: null,
    refundPolicyText: null,
    termsVersion: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("pricing & capacity", () => {
  it("resolves early bird tier prices", () => {
    const tt = {
      id: "tt1",
      eventId: "evt1",
      name: "Ordinær",
      description: null,
      price: 29900,
      vatRate: 2500,
      taxTreatmentId: null,
      serviceFeeTaxTreatmentId: null,
      serviceFee: null,
      quantityTotal: 350,
      quantitySold: 50,
      quantityReserved: 0,
      maxPerOrder: 8,
      minPerOrder: 1,
      salesStartAt: null,
      salesEndAt: null,
      isVisible: true,
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      priceTiers: [
        { id: "1", ticketTypeId: "tt1", name: "Fase 2", price: 24900, quantityFrom: 0, quantityTo: 199, sortOrder: 0, createdAt: new Date() },
        { id: "2", ticketTypeId: "tt1", name: "Ordinær", price: 29900, quantityFrom: 200, quantityTo: 349, sortOrder: 1, createdAt: new Date() },
      ],
    };
    expect(resolveUnitPrice(tt)).toBe(24900);
    expect(resolveUnitPrice({ ...tt, quantitySold: 200 })).toBe(29900);
  });

  it("computes available quantity without overselling", () => {
    expect(getAvailableQuantity({ quantityTotal: 100, quantitySold: 90, quantityReserved: 10 })).toBe(0);
    expect(getAvailableQuantity({ quantityTotal: 100, quantitySold: 90, quantityReserved: 5 })).toBe(5);
  });

  it("adds service fee on top", () => {
    const tt = {
      id: "tt1",
      eventId: "evt1",
      name: "VIP",
      description: null,
      price: 49900,
      vatRate: 2500,
      taxTreatmentId: null,
      serviceFeeTaxTreatmentId: null,
      serviceFee: null,
      quantityTotal: 50,
      quantitySold: 0,
      quantityReserved: 0,
      maxPerOrder: 4,
      minPerOrder: 1,
      salesStartAt: null,
      salesEndAt: null,
      isVisible: true,
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      priceTiers: [],
    };
    const pricing = calculatePricing({
      organization: mockOrg(),
      event: mockEvent(),
      ticketTypes: [tt],
      items: [{ ticketTypeId: "tt1", quantity: 2 }],
    });
    expect(pricing.subtotal).toBe(99800);
    expect(pricing.serviceFee).toBe(4000);
    expect(pricing.total).toBe(103800);
  });

  it("applies percentage promo", () => {
    const promo = {
      id: "p1",
      organizationId: "org1",
      eventId: "evt1",
      ticketTypeId: null,
      code: "VIP20",
      discountType: "PERCENTAGE" as const,
      discountValue: 2000,
      maxUses: 100,
      usedCount: 0,
      startAt: null,
      expiresAt: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies PromoCode;
    expect(applyPromo(promo, 100000)).toBe(20000);
  });
});

describe("QR token security", () => {
  it("generates non-sequential secure tokens", () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
    expect(generatePublicTicketId()).toMatch(/^TKT-[A-Z0-9]+$/);
  });
});

describe("RBAC", () => {
  const door: AuthUser = {
    id: "u1",
    email: "door@example.com",
    name: "Door",
    globalRole: GlobalRole.CUSTOMER,
    isActive: true,
    memberships: [
      { organizationId: "org1", role: OrgRole.DOOR_STAFF, canRefund: false, isActive: true },
    ],
  };

  const organizer: AuthUser = {
    id: "u2",
    email: "organizer@example.com",
    name: "Org",
    globalRole: GlobalRole.CUSTOMER,
    isActive: true,
    memberships: [
      { organizationId: "org1", role: OrgRole.ORGANIZER_ADMIN, canRefund: true, isActive: true },
    ],
  };

  const admin: AuthUser = {
    id: "u3",
    email: "admin@example.com",
    name: "Admin",
    globalRole: GlobalRole.SUPER_ADMIN,
    isActive: true,
    memberships: [],
  };

  it("allows door staff to scan but not manage events", () => {
    expect(canScanTickets(door, "org1")).toBe(true);
    expect(canManageEvents(door, "org1")).toBe(false);
  });

  it("isolates organizations", () => {
    expect(canScanTickets(door, "org2")).toBe(false);
    expect(canManageEvents(organizer, "org2")).toBe(false);
  });

  it("super admin bypasses org checks", () => {
    expect(isSuperAdmin(admin)).toBe(true);
    expect(canManageEvents(admin, "any")).toBe(true);
  });
});
