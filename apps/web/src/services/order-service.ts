import {
  EventStatus,
  OrderStatus,
  PaymentStatus,
  ServiceFeeMode,
  type DiscountType,
  type Event,
  type Organization,
  type PromoCode,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateOrderNumber } from "@/lib/orders/order-number";
import { generateOrderAccessToken } from "@/lib/tickets/token";
import { AppError } from "@/lib/api-error";
import {
  ReservationService,
  getAvailableQuantity,
  resolveUnitPrice,
  type TicketTypeWithTiers,
} from "@/services/reservation-service";

export type PricingLine = {
  ticketTypeId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  serviceFeePerTicket: number;
  lineSubtotal: number;
  lineServiceFee: number;
  lineTotal: number;
};

export type PricingResult = {
  lines: PricingLine[];
  subtotal: number;
  serviceFee: number;
  discount: number;
  tax: number;
  total: number;
  currency: string;
  promoCodeId?: string;
};

function resolveServiceFee(
  org: Organization,
  event: Event,
  ticketTypeFee: number | null | undefined
): { fee: number; mode: ServiceFeeMode } {
  const fee =
    ticketTypeFee ??
    event.serviceFee ??
    org.defaultServiceFee;
  const mode = event.serviceFeeMode ?? org.defaultServiceFeeMode;
  return { fee, mode };
}

export function calculatePricing(input: {
  organization: Organization;
  event: Event;
  ticketTypes: TicketTypeWithTiers[];
  items: { ticketTypeId: string; quantity: number }[];
  promo?: PromoCode | null;
}): PricingResult {
  const lines: PricingLine[] = [];
  let subtotal = 0;
  let serviceFee = 0;

  for (const item of input.items) {
    const tt = input.ticketTypes.find((t) => t.id === item.ticketTypeId);
    if (!tt) throw new AppError("UNKNOWN_TICKET_TYPE", `Ukjent billettype: ${item.ticketTypeId}`, 400);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new AppError("INVALID_QUANTITY", "Ugyldig antall", 400);
    }

    const { fee, mode } = resolveServiceFee(input.organization, input.event, tt.serviceFee);
    let lineSubtotal = 0;
    for (let i = 0; i < item.quantity; i++) {
      lineSubtotal += resolveUnitPrice(tt, i);
    }
    const unitPrice = Math.round(lineSubtotal / item.quantity);
    const lineServiceFee = mode === ServiceFeeMode.ON_TOP ? fee * item.quantity : 0;
    const includedFee = mode === ServiceFeeMode.INCLUDED ? fee * item.quantity : 0;

    lines.push({
      ticketTypeId: tt.id,
      name: tt.name,
      quantity: item.quantity,
      unitPrice,
      serviceFeePerTicket: fee,
      lineSubtotal,
      lineServiceFee: lineServiceFee || includedFee,
      lineTotal: lineSubtotal + lineServiceFee,
    });

    subtotal += lineSubtotal;
    serviceFee += lineServiceFee || includedFee;
  }

  let discount = 0;
  if (input.promo) {
    discount = applyPromo(input.promo, subtotal);
  }

  const taxableBase = Math.max(0, subtotal - discount);
  const tax = Math.round(taxableBase - taxableBase / 1.25);

  const totalOnTop = lines.reduce((s, l) => s + l.lineSubtotal, 0) - discount +
    lines.reduce((s, l) => {
      const { mode } = resolveServiceFee(
        input.organization,
        input.event,
        input.ticketTypes.find((t) => t.id === l.ticketTypeId)?.serviceFee
      );
      return s + (mode === ServiceFeeMode.ON_TOP ? l.lineServiceFee : 0);
    }, 0);

  return {
    lines,
    subtotal,
    serviceFee,
    discount,
    tax,
    total: Math.max(0, totalOnTop),
    currency: input.event.currency,
    promoCodeId: input.promo?.id,
  };
}

export function applyPromo(promo: PromoCode, subtotal: number): number {
  if (!promo.isActive) return 0;
  const now = new Date();
  if (promo.startAt && promo.startAt > now) return 0;
  if (promo.expiresAt && promo.expiresAt < now) return 0;
  if (promo.maxUses != null && promo.usedCount >= promo.maxUses) return 0;

  if (promo.discountType === ("PERCENTAGE" as DiscountType)) {
    return Math.round((subtotal * promo.discountValue) / 10000);
  }
  return Math.min(subtotal, promo.discountValue);
}

export class OrderService {
  /**
   * Create pending order. Client may only supply ticketTypeId + quantity + promoCode + contact.
   * Price / fee / tax / total are computed exclusively from DB.
   */
  static async createPendingOrder(input: {
    eventId: string;
    sessionId: string;
    items: { ticketTypeId: string; quantity: number }[];
    customer: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      customerId?: string;
    };
    promoCode?: string;
    termsAccepted?: boolean;
    termsVersion?: string;
  }) {
    // Strip any client-supplied pricing if somehow present on items
    const safeItems = input.items.map((i) => ({
      ticketTypeId: i.ticketTypeId,
      quantity: i.quantity,
    }));

    if (input.termsAccepted === false) {
      throw new AppError("TERMS_REQUIRED", "Du må godta vilkårene", 400);
    }

    await ReservationService.reserve({
      eventId: input.eventId,
      sessionId: input.sessionId,
      items: safeItems,
    });

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: input.eventId },
      include: { organization: true },
    });

    if (event.status === EventStatus.CANCELLED) {
      throw new AppError("EVENT_CANCELLED", "Arrangementet er kansellert", 409);
    }

    const ticketTypes = await prisma.ticketType.findMany({
      where: { eventId: input.eventId, id: { in: safeItems.map((i) => i.ticketTypeId) } },
      include: { priceTiers: true },
    });

    for (const tt of ticketTypes) {
      if (!tt.isPubliclyPurchasable) {
        throw new AppError(
          "FREE_TICKET_NOT_PUBLIC",
          "Denne billettypen kan ikke kjøpes offentlig",
          403
        );
      }
    }

    const orderNumber = await generateOrderNumber();
    const accessToken = generateOrderAccessToken();
    const termsVersion = input.termsVersion ?? process.env.TERMS_VERSION ?? "2026-01";

    const order = await prisma.$transaction(async (tx) => {
      let promo: PromoCode | null = null;
      if (input.promoCode) {
        const locked = await tx.$queryRaw<PromoCode[]>`
          SELECT * FROM "PromoCode"
          WHERE LOWER(code) = LOWER(${input.promoCode})
            AND "organizationId" = ${event.organizationId}
            AND "isActive" = true
            AND ("eventId" IS NULL OR "eventId" = ${event.id})
          FOR UPDATE
        `;
        promo = locked[0] ?? null;
        if (promo) {
          const now = new Date();
          if (promo.startAt && promo.startAt > now) promo = null;
          else if (promo.expiresAt && promo.expiresAt < now) promo = null;
          else if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
            throw new AppError("PROMO_EXHAUSTED", "Kampanjekoden er oppbrukt", 409);
          }
        }
      }

      const pricing = calculatePricing({
        organization: event.organization,
        event,
        ticketTypes,
        items: safeItems,
        promo,
      });

      if (pricing.total < 0) throw new AppError("INVALID_TOTAL", "Ugyldig totalsum", 400);

      const created = await tx.order.create({
        data: {
          orderNumber,
          accessToken,
          organizationId: event.organizationId,
          sellerOrganizationId: event.organizationId,
          eventId: event.id,
          customerId: input.customer.customerId,
          customerEmail: input.customer.email.toLowerCase(),
          customerPhone: input.customer.phone,
          customerFirstName: input.customer.firstName,
          customerLastName: input.customer.lastName,
          subtotal: pricing.subtotal,
          serviceFee: pricing.serviceFee,
          tax: pricing.tax,
          discount: pricing.discount,
          total: pricing.total,
          currency: pricing.currency,
          paymentStatus: PaymentStatus.PENDING,
          orderStatus: OrderStatus.PENDING,
          promoCodeId: pricing.promoCodeId,
          reservationSessionId: input.sessionId,
          termsVersion,
          termsAcceptedAt: new Date(),
          items: {
            create: pricing.lines.map((line) => ({
              ticketTypeId: line.ticketTypeId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              serviceFee: line.lineServiceFee,
              tax: 0,
              total: line.lineTotal,
              name: line.name,
            })),
          },
        },
        include: { items: true, event: true },
      });

      await ReservationService.convertToOrder(input.sessionId, created.id, tx);

      if (promo) {
        await tx.promoCode.update({
          where: { id: promo.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      return created;
    });

    return order;
  }

  static async getByOrderNumber(orderNumber: string) {
    return prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: true,
        tickets: { include: { ticketType: true } },
        event: { include: { organization: true, venue: true } },
        payments: true,
      },
    });
  }

  static async getAvailability(eventId: string) {
    const types = await prisma.ticketType.findMany({
      where: { eventId, isVisible: true, isPubliclyPurchasable: true },
      include: { priceTiers: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    return types.map((tt) => ({
      ...tt,
      available: getAvailableQuantity(tt),
      currentPrice: resolveUnitPrice(tt),
    }));
  }
}
