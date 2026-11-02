import type { DiscountType, PromoCode, PromoCodeKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import {
  GROSS_SALES_PAYMENT_STATUSES,
  aggregateFinancialTotals,
  computeNetRevenue,
} from "@/lib/admin/event-financials";
import { buildPromoterTrackingPath, buildPromoterTrackingUrl } from "@/lib/promoter";

export type PromoInput = {
  organizationId: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  eventId?: string | null;
  ticketTypeId?: string | null;
  maxUses?: number | null;
  startAt?: Date | null;
  expiresAt?: Date | null;
  isActive?: boolean;
  label?: string | null;
  kind?: PromoCodeKind | "DISCOUNT" | "TRACKING";
};

export type PromoterSalesRow = {
  id: string;
  code: string;
  label: string | null;
  kind: PromoCodeKind;
  discountType: DiscountType;
  discountValue: number;
  isActive: boolean;
  usedCount: number;
  maxUses: number | null;
  eventId: string | null;
  event: { id: string; name: string; slug: string } | null;
  trackingPath: string | null;
  trackingUrl: string | null;
  ordersCount: number;
  ticketsSold: number;
  grossSales: number;
  successfulRefundAmount: number;
  netRevenue: number;
};

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function resolveKind(kind?: PromoCodeKind | "DISCOUNT" | "TRACKING"): PromoCodeKind {
  return kind === "TRACKING" ? ("TRACKING" as PromoCodeKind) : ("DISCOUNT" as PromoCodeKind);
}

export class PromoService {
  static async list(organizationId: string, eventId?: string) {
    return prisma.promoCode.findMany({
      where: {
        organizationId,
        ...(eventId ? { OR: [{ eventId }, { eventId: null }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { id: true, name: true, slug: true } },
        ticketType: { select: { id: true, name: true } },
      },
    });
  }

  static async create(input: PromoInput, actorId?: string) {
    const code = normalizeCode(input.code);
    const kind = resolveKind(input.kind);
    if (!code || code.length < 2) {
      throw new AppError("INVALID_PROMO", "Ugyldig kampanjekode", 400);
    }
    // TRACKING (promoter) is attribution-only — always store zero discount.
    const discountValue = kind === "TRACKING" ? 0 : input.discountValue;
    if (kind === "DISCOUNT" && discountValue <= 0) {
      throw new AppError("INVALID_PROMO", "Rabatt må være positiv", 400);
    }
    if (kind === "DISCOUNT" && input.discountType === "PERCENTAGE" && discountValue > 10000) {
      throw new AppError("INVALID_PROMO", "Prosentrabatt kan ikke overstige 100%", 400);
    }

    const created = await prisma.promoCode.create({
      data: {
        organizationId: input.organizationId,
        code,
        label: input.label?.trim() || null,
        kind,
        discountType: input.discountType,
        discountValue,
        eventId: input.eventId ?? null,
        ticketTypeId: input.ticketTypeId ?? null,
        maxUses: input.maxUses ?? null,
        startAt: input.startAt ?? null,
        expiresAt: input.expiresAt ?? null,
        isActive: input.isActive ?? true,
      },
    });

    await writeAuditLog({
      actorId,
      organizationId: input.organizationId,
      action: kind === "TRACKING" ? "PROMOTER_CREATED" : "PROMO_CREATED",
      entityType: "PromoCode",
      entityId: created.id,
      metadata: { code: created.code, kind, label: created.label },
    });

    return created;
  }

  static async update(
    id: string,
    organizationId: string,
    data: Partial<PromoInput> & { isActive?: boolean },
    actorId?: string
  ) {
    const existing = await prisma.promoCode.findFirst({ where: { id, organizationId } });
    if (!existing) throw new AppError("PROMO_NOT_FOUND", "Kampanjekode ikke funnet", 404);

    const nextKind = data.kind != null ? resolveKind(data.kind) : existing.kind;
    // TRACKING is attribution-only — force zero discount on write / kind flip.
    const nextDiscount =
      nextKind === "TRACKING"
        ? 0
        : data.discountValue != null
          ? data.discountValue
          : existing.discountValue;
    if (nextKind === "DISCOUNT" && nextDiscount <= 0) {
      throw new AppError("INVALID_PROMO", "Rabatt må være positiv", 400);
    }
    if (nextKind === "DISCOUNT" && (data.discountType ?? existing.discountType) === "PERCENTAGE" && nextDiscount > 10000) {
      throw new AppError("INVALID_PROMO", "Prosentrabatt kan ikke overstige 100%", 400);
    }

    const updated = await prisma.promoCode.update({
      where: { id },
      data: {
        ...(data.code ? { code: normalizeCode(data.code) } : {}),
        ...(data.label !== undefined ? { label: data.label?.trim() || null } : {}),
        ...(data.kind != null ? { kind: nextKind } : {}),
        ...(data.discountType && nextKind !== "TRACKING" ? { discountType: data.discountType } : {}),
        ...(nextKind === "TRACKING" || data.discountValue != null
          ? { discountValue: nextDiscount }
          : {}),
        ...(data.eventId !== undefined ? { eventId: data.eventId } : {}),
        ...(data.ticketTypeId !== undefined ? { ticketTypeId: data.ticketTypeId } : {}),
        ...(data.maxUses !== undefined ? { maxUses: data.maxUses } : {}),
        ...(data.startAt !== undefined ? { startAt: data.startAt } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });

    if (data.isActive === false) {
      await writeAuditLog({
        actorId,
        organizationId,
        action: "PROMO_DISABLED",
        entityType: "PromoCode",
        entityId: id,
      });
    }

    return updated;
  }

  static isApplicable(
    promo: PromoCode,
    opts: { eventId: string; ticketTypeIds: string[]; now?: Date }
  ): { ok: true } | { ok: false; reason: string } {
    const now = opts.now ?? new Date();
    if (!promo.isActive) return { ok: false, reason: "inactive" };
    if (promo.eventId && promo.eventId !== opts.eventId) return { ok: false, reason: "wrong_event" };
    if (promo.ticketTypeId && !opts.ticketTypeIds.includes(promo.ticketTypeId)) {
      return { ok: false, reason: "wrong_ticket_type" };
    }
    if (promo.startAt && promo.startAt > now) return { ok: false, reason: "not_started" };
    if (promo.expiresAt && promo.expiresAt < now) return { ok: false, reason: "expired" };
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      return { ok: false, reason: "exhausted" };
    }
    return { ok: true };
  }

  static async salesReport(opts: {
    organizationId: string;
    eventId?: string | null;
    kind?: PromoCodeKind | "DISCOUNT" | "TRACKING" | "ALL";
    baseUrl?: string;
  }): Promise<PromoterSalesRow[]> {
    const kindFilter =
      !opts.kind || opts.kind === "ALL"
        ? undefined
        : resolveKind(opts.kind as PromoCodeKind | "DISCOUNT" | "TRACKING");

    const promos = await prisma.promoCode.findMany({
      where: {
        organizationId: opts.organizationId,
        ...(kindFilter ? { kind: kindFilter } : {}),
        ...(opts.eventId
          ? { OR: [{ eventId: opts.eventId }, { eventId: null }] }
          : {}),
      },
      include: {
        event: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
    });

    if (promos.length === 0) return [];

    const promoIds = promos.map((p) => p.id);
    const orderWhere = {
      promoCodeId: { in: promoIds },
      ...(opts.eventId ? { eventId: opts.eventId } : { organizationId: opts.organizationId }),
      OR: [
        { paidAt: { not: null } },
        { paymentStatus: { in: GROSS_SALES_PAYMENT_STATUSES } },
      ],
    };

    const [orders, refunds, tickets] = await Promise.all([
      prisma.order.findMany({
        where: orderWhere,
        select: {
          id: true,
          promoCodeId: true,
          total: true,
          serviceFee: true,
          paidAt: true,
          paymentStatus: true,
        },
      }),
      prisma.refund.findMany({
        where: {
          status: "SUCCEEDED",
          order: {
            promoCodeId: { in: promoIds },
            ...(opts.eventId
              ? { eventId: opts.eventId }
              : { organizationId: opts.organizationId }),
          },
        },
        select: { amount: true, status: true, order: { select: { promoCodeId: true } } },
      }),
      prisma.ticket.findMany({
        where: {
          order: {
            promoCodeId: { in: promoIds },
            ...(opts.eventId
              ? { eventId: opts.eventId }
              : { organizationId: opts.organizationId }),
            OR: [
              { paidAt: { not: null } },
              { paymentStatus: { in: GROSS_SALES_PAYMENT_STATUSES } },
            ],
          },
        },
        select: { status: true, order: { select: { promoCodeId: true } } },
      }),
    ]);

    const baseUrl =
      opts.baseUrl ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.APP_URL ??
      "http://localhost:3456";

    return promos.map((promo) => {
      const promoOrders = orders.filter((o) => o.promoCodeId === promo.id);
      const promoRefunds = refunds
        .filter((r) => r.order.promoCodeId === promo.id)
        .map((r) => ({ amount: r.amount, status: r.status }));
      const promoTickets = tickets
        .filter((t) => t.order.promoCodeId === promo.id)
        .map((t) => ({ status: t.status }));

      const totals = aggregateFinancialTotals({
        orders: promoOrders,
        refunds: promoRefunds,
        tickets: promoTickets,
      });

      const slug = promo.event?.slug ?? null;
      const trackingPath = slug ? buildPromoterTrackingPath(slug, promo.code) : null;
      const trackingUrl = slug
        ? buildPromoterTrackingUrl(baseUrl, slug, promo.code)
        : null;

      return {
        id: promo.id,
        code: promo.code,
        label: promo.label,
        kind: promo.kind,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        isActive: promo.isActive,
        usedCount: promo.usedCount,
        maxUses: promo.maxUses,
        eventId: promo.eventId,
        event: promo.event,
        trackingPath,
        trackingUrl,
        ordersCount: totals.paidOrderCount,
        ticketsSold: totals.activeSoldTicketCount,
        grossSales: totals.grossSales,
        successfulRefundAmount: totals.successfulRefundAmount,
        netRevenue: computeNetRevenue(totals.grossSales, totals.successfulRefundAmount),
      };
    });
  }
}

export function softResolvePromoApplicability(
  promo: PromoCode | null,
  opts: { eventId: string; ticketTypeIds: string[]; now?: Date }
): { promo: PromoCode | null; softSkipped: boolean; reason?: string } {
  if (!promo) return { promo: null, softSkipped: false };
  const check = PromoService.isApplicable(promo, opts);
  if (check.ok) return { promo, softSkipped: false };

  if (promo.kind === "TRACKING") {
    return { promo: null, softSkipped: true, reason: check.reason };
  }

  return { promo, softSkipped: false, reason: check.reason };
}
