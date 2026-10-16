import type { DiscountType, PromoCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";

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
};

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

export class PromoService {
  static async list(organizationId: string, eventId?: string) {
    return prisma.promoCode.findMany({
      where: {
        organizationId,
        ...(eventId ? { OR: [{ eventId }, { eventId: null }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { event: { select: { id: true, name: true } }, ticketType: { select: { id: true, name: true } } },
    });
  }

  static async create(input: PromoInput, actorId?: string) {
    const code = normalizeCode(input.code);
    if (!code || code.length < 2) {
      throw new AppError("INVALID_PROMO", "Ugyldig kampanjekode", 400);
    }
    if (input.discountValue <= 0) {
      throw new AppError("INVALID_PROMO", "Rabatt må være positiv", 400);
    }
    if (input.discountType === "PERCENTAGE" && input.discountValue > 10000) {
      throw new AppError("INVALID_PROMO", "Prosentrabatt kan ikke overstige 100%", 400);
    }

    const created = await prisma.promoCode.create({
      data: {
        organizationId: input.organizationId,
        code,
        discountType: input.discountType,
        discountValue: input.discountValue,
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
      action: "PROMO_CREATED",
      entityType: "PromoCode",
      entityId: created.id,
      metadata: { code: created.code },
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

    const updated = await prisma.promoCode.update({
      where: { id },
      data: {
        ...(data.code ? { code: normalizeCode(data.code) } : {}),
        ...(data.discountType ? { discountType: data.discountType } : {}),
        ...(data.discountValue != null ? { discountValue: data.discountValue } : {}),
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

  /** Validate promo for an event/cart — backend-only pricing. */
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
}
