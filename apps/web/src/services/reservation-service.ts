import {
  EventStatus,
  OrderStatus,
  PaymentStatus,
  ReservationStatus,
  type Prisma,
  type TicketType,
  type TicketPriceTier,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";

export type TicketTypeWithTiers = TicketType & { priceTiers: TicketPriceTier[] };

/** Public/customer available = released − sold − reserved (not full capacity) */
export function getAvailableQuantity(
  tt: Pick<TicketType, "quantitySold" | "quantityReserved"> & {
    quantityReleased?: number;
    quantityTotal?: number;
  }
) {
  const released =
    tt.quantityReleased ??
    tt.quantityTotal ??
    0;
  return Math.max(0, released - tt.quantitySold - tt.quantityReserved);
}

/** Resolve unit price based on early-bird tiers and current sold count */
export function resolveUnitPrice(
  ticketType: TicketTypeWithTiers,
  soldOffset = 0
): number {
  const sold = ticketType.quantitySold + soldOffset;
  const tiers = [...ticketType.priceTiers].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const tier of tiers) {
    if (sold >= tier.quantityFrom && sold <= tier.quantityTo) {
      return tier.price;
    }
  }
  return ticketType.price;
}

/** Grace minutes after reservation expiry while payment webhook may still arrive */
export function paymentGraceMinutes() {
  return Number(process.env.PAYMENT_GRACE_MINUTES ?? 15);
}

export type ReservationRepairTicketTypeRow = {
  ticketTypeId: string;
  name: string;
  quantityReleased: number;
  quantitySold: number;
  currentQuantityReserved: number;
  activeTotal: number;
  activeUnexpiredTotal: number;
  expiredActiveQuantity: number;
  expiredActiveCount: number;
  proposedQuantityReserved: number;
  delta: number;
  availableBefore: number;
  availableAfter: number;
};

export type ReservationRepairResult = {
  eventId: string;
  dryRun: boolean;
  now: string;
  graceMinutes: number;
  expiredCount: number;
  types: ReservationRepairTicketTypeRow[];
  applied: boolean;
};

type ReservationWithOrder = {
  id: string;
  ticketTypeId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
  orderId: string | null;
  order: {
    id: string;
    paymentStatus: PaymentStatus;
    orderStatus: OrderStatus;
    paidAt: Date | null;
  } | null;
};

/**
 * Whether an ACTIVE reservation whose clock has expired should still be held
 * (payment webhook race) or marked EXPIRED.
 */
export function shouldExpireReservation(
  res: Pick<ReservationWithOrder, "expiresAt" | "order">,
  now: Date,
  graceCutoff: Date
): boolean {
  if (res.expiresAt > now) return false;

  // Never release if order already paid — fulfillment owns inventory
  if (res.order?.paymentStatus === PaymentStatus.PAID) {
    return false;
  }

  // Hold while PENDING/unpaid within payment grace window
  if (
    res.order &&
    res.order.paymentStatus === PaymentStatus.PENDING &&
    res.order.orderStatus === OrderStatus.PENDING &&
    res.expiresAt > graceCutoff
  ) {
    return false;
  }

  // Abandoned / past-grace PENDING, no order, cancelled unpaid, etc.
  return true;
}

/**
 * Steady-state source of truth for TicketType.quantityReserved:
 * SUM(quantity) WHERE status = ACTIVE AND expiresAt > now
 *
 * During payment grace / PAID-awaiting-fulfillment, ACTIVE rows with
 * expiresAt <= now that we intentionally keep also count (prevents oversell).
 * After grace elapses those PENDING rows are expired and drop out.
 */
export function sumActiveUnexpired(
  reservations: Array<Pick<ReservationWithOrder, "status" | "expiresAt" | "quantity">>,
  now: Date
): number {
  return reservations
    .filter((r) => r.status === ReservationStatus.ACTIVE && r.expiresAt > now)
    .reduce((s, r) => s + r.quantity, 0);
}

/** Reservations that remain ACTIVE and must hold inventory after a repair pass */
export function sumQuantityReservedTruth(
  reservations: ReservationWithOrder[],
  now: Date,
  graceCutoff: Date
): number {
  return reservations
    .filter((r) => r.status === ReservationStatus.ACTIVE)
    .filter((r) => !shouldExpireReservation(r, now, graceCutoff))
    .reduce((s, r) => s + r.quantity, 0);
}

/** Throttle cheap opportunistic cleanup so public reads don't hammer DB */
const CLEANUP_INTERVAL_MS = Number(process.env.RESERVATION_CLEANUP_INTERVAL_MS ?? 30_000);
const lastCleanupAt = new Map<string, number>();

/** Test helper — clear opportunistic cleanup throttle */
export function resetReservationCleanupThrottle() {
  lastCleanupAt.clear();
}

export class ReservationService {
  static ttlMinutes() {
    return Number(process.env.RESERVATION_TTL_MINUTES ?? 10);
  }

  /**
   * Release expired reservations and free reserved quantity.
   * Never release inventory tied to a PENDING order still within payment grace
   * (prevents oversale when webhook races cleanup).
   *
   * Prefer `repairEvent` when counters may be stale — this path still uses
   * decrement for backwards-compatible callers, then is safe under repair rebuild.
   */
  static async releaseExpired(tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - paymentGraceMinutes() * 60_000);

    const expired = await db.ticketReservation.findMany({
      where: { status: ReservationStatus.ACTIVE, expiresAt: { lt: now } },
      include: { order: { select: { id: true, paymentStatus: true, orderStatus: true, paidAt: true } } },
    });

    let released = 0;
    for (const res of expired) {
      if (!shouldExpireReservation(res, now, graceCutoff)) {
        continue;
      }

      await db.ticketReservation.update({
        where: { id: res.id },
        data: { status: ReservationStatus.EXPIRED },
      });
      await db.ticketType.update({
        where: { id: res.ticketTypeId },
        data: { quantityReserved: { decrement: res.quantity } },
      });
      released++;
    }

    return released;
  }

  /**
   * Preview or apply reservation repair for one event.
   *
   * Apply (transaction):
   * 1. Mark ACTIVE with expiresAt <= now as EXPIRED (respecting payment grace / PAID)
   * 2. Set TicketType.quantityReserved exactly to SUM(ACTIVE ∧ expiresAt > now)
   * 3. Audit INVENTORY_RESERVATION_REPAIR
   *
   * Never touches quantitySold, paid tickets, orders, or payments.
   */
  static async repairEvent(input: {
    eventId: string;
    apply?: boolean;
    actorId?: string | null;
  }): Promise<ReservationRepairResult> {
    const apply = Boolean(input.apply);
    const now = new Date();
    const graceMinutes = paymentGraceMinutes();
    const graceCutoff = new Date(now.getTime() - graceMinutes * 60_000);

    const event = await prisma.event.findUnique({
      where: { id: input.eventId },
      include: {
        ticketTypes: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!event) throw new AppError("EVENT_NOT_FOUND", "Arrangement ikke funnet", 404);

    const reservations = await prisma.ticketReservation.findMany({
      where: { eventId: input.eventId, status: ReservationStatus.ACTIVE },
      include: {
        order: { select: { id: true, paymentStatus: true, orderStatus: true, paidAt: true } },
      },
    });

    const byType = new Map<string, ReservationWithOrder[]>();
    for (const tt of event.ticketTypes) {
      byType.set(tt.id, []);
    }
    for (const r of reservations) {
      const list = byType.get(r.ticketTypeId) ?? [];
      list.push(r);
      byType.set(r.ticketTypeId, list);
    }

    const typeRows: ReservationRepairTicketTypeRow[] = [];
    const toExpireIds: string[] = [];
    let expiredCount = 0;

    for (const tt of event.ticketTypes) {
      const list = byType.get(tt.id) ?? [];
      const activeTotal = list.reduce((s, r) => s + r.quantity, 0);
      const activeUnexpiredTotal = sumActiveUnexpired(list, now);

      let expiredActiveQuantity = 0;
      let expiredActiveCount = 0;
      for (const r of list) {
        if (shouldExpireReservation(r, now, graceCutoff)) {
          expiredActiveQuantity += r.quantity;
          expiredActiveCount += 1;
          toExpireIds.push(r.id);
        }
      }

      // Exact counter = ACTIVE keepers (unexpired + grace/PAID holds)
      const proposedQuantityReserved = sumQuantityReservedTruth(list, now, graceCutoff);
      const delta = proposedQuantityReserved - tt.quantityReserved;
      const availableBefore = Math.max(
        0,
        tt.quantityReleased - tt.quantitySold - tt.quantityReserved
      );
      const availableAfter = Math.max(
        0,
        tt.quantityReleased - tt.quantitySold - proposedQuantityReserved
      );

      typeRows.push({
        ticketTypeId: tt.id,
        name: tt.name,
        quantityReleased: tt.quantityReleased,
        quantitySold: tt.quantitySold,
        currentQuantityReserved: tt.quantityReserved,
        activeTotal,
        activeUnexpiredTotal,
        expiredActiveQuantity,
        expiredActiveCount,
        proposedQuantityReserved,
        delta,
        availableBefore,
        availableAfter,
      });
      expiredCount += expiredActiveCount;
    }

    if (!apply) {
      return {
        eventId: input.eventId,
        dryRun: true,
        now: now.toISOString(),
        graceMinutes,
        expiredCount,
        types: typeRows,
        applied: false,
      };
    }

    await prisma.$transaction(async (tx) => {
      // Lock ticket types for this event
      await tx.$queryRaw`
        SELECT id FROM "TicketType" WHERE "eventId" = ${input.eventId} FOR UPDATE
      `;

      if (toExpireIds.length > 0) {
        await tx.ticketReservation.updateMany({
          where: { id: { in: toExpireIds }, status: ReservationStatus.ACTIVE },
          data: { status: ReservationStatus.EXPIRED },
        });
      }

      // Re-read ACTIVE after expire; set quantityReserved exactly from keepers
      const remaining = await tx.ticketReservation.findMany({
        where: { eventId: input.eventId, status: ReservationStatus.ACTIVE },
        include: {
          order: { select: { id: true, paymentStatus: true, orderStatus: true, paidAt: true } },
        },
      });

      const truthByType = new Map<string, number>();
      for (const tt of event.ticketTypes) {
        truthByType.set(tt.id, 0);
      }
      for (const r of remaining) {
        // Remaining ACTIVE should already be keepers; still filter defensively
        if (!shouldExpireReservation(r, now, graceCutoff)) {
          truthByType.set(r.ticketTypeId, (truthByType.get(r.ticketTypeId) ?? 0) + r.quantity);
        }
      }

      for (const tt of event.ticketTypes) {
        const proposed = truthByType.get(tt.id) ?? 0;
        if (proposed !== tt.quantityReserved) {
          await tx.ticketType.update({
            where: { id: tt.id },
            data: { quantityReserved: proposed },
          });
        }
      }
    });

    await writeAuditLog({
      actorId: input.actorId,
      organizationId: event.organizationId,
      action: "INVENTORY_RESERVATION_REPAIR",
      entityType: "Event",
      entityId: input.eventId,
      metadata: {
        dryRun: false,
        expiredCount,
        types: typeRows.map((t) => ({
          ticketTypeId: t.ticketTypeId,
          from: t.currentQuantityReserved,
          to: t.proposedQuantityReserved,
          delta: t.delta,
          expiredActiveCount: t.expiredActiveCount,
          expiredActiveQuantity: t.expiredActiveQuantity,
        })),
      },
    });

    return {
      eventId: input.eventId,
      dryRun: false,
      now: now.toISOString(),
      graceMinutes,
      expiredCount,
      types: typeRows,
      applied: true,
    };
  }

  /**
   * Lightweight invariant: stored quantityReserved must equal the sum of ACTIVE
   * reservations that should still hold inventory (unexpired + payment-grace /
   * PAID keepers). Also flags ACTIVE rows that should expire.
   *
   * Read-only — use before sales/inventory decisions; repair when `needsRepair`.
   */
  static async checkQuantityReservedInvariant(eventId: string): Promise<{
    needsRepair: boolean;
    expiredCount: number;
    types: Array<{
      ticketTypeId: string;
      name: string;
      storedQuantityReserved: number;
      calculatedActiveReserved: number;
      delta: number;
      expiredActiveCount: number;
    }>;
  }> {
    const preview = await this.repairEvent({ eventId, apply: false });
    const needsRepair =
      preview.expiredCount > 0 || preview.types.some((t) => t.delta !== 0);
    return {
      needsRepair,
      expiredCount: preview.expiredCount,
      types: preview.types.map((t) => ({
        ticketTypeId: t.ticketTypeId,
        name: t.name,
        storedQuantityReserved: t.currentQuantityReserved,
        calculatedActiveReserved: t.proposedQuantityReserved,
        delta: t.delta,
        expiredActiveCount: t.expiredActiveCount,
      })),
    };
  }

  /**
   * Ensure inventory counters are consistent before a sales/availability read.
   * Always corrects drift when detected; throttles only the no-op happy path
   * so public pages do not hammer the DB when nothing is wrong.
   */
  static async ensureInventoryConsistent(
    eventId: string,
    opts?: { force?: boolean; actorId?: string | null }
  ): Promise<ReservationRepairResult | null> {
    return this.cleanupEventSafe(eventId, opts);
  }

  /**
   * Cheap, idempotent cleanup: expire stale ACTIVE + rebuild quantityReserved
   * from DB truth for one event.
   *
   * Throttle skips repeated dry-runs when the last pass found nothing to fix.
   * If throttle would skip but a lightweight invariant detects drift, repair
   * runs anyway — sales decisions must never leave counters uncorrected.
   */
  static async cleanupEventSafe(
    eventId: string,
    opts?: { force?: boolean; actorId?: string | null; audit?: boolean }
  ): Promise<ReservationRepairResult | null> {
    const key = eventId;
    const last = lastCleanupAt.get(key) ?? 0;
    const throttled = !opts?.force && Date.now() - last < CLEANUP_INTERVAL_MS;

    try {
      if (throttled) {
        const invariant = await this.checkQuantityReservedInvariant(eventId);
        if (!invariant.needsRepair) {
          return null;
        }
        lastCleanupAt.set(key, Date.now());
        return await this.repairEvent({
          eventId,
          apply: true,
          actorId: opts?.actorId,
        });
      }

      lastCleanupAt.set(key, Date.now());
      const preview = await this.repairEvent({ eventId, apply: false });
      const needsWork =
        preview.expiredCount > 0 || preview.types.some((t) => t.delta !== 0);
      if (!needsWork) {
        return preview;
      }
      return await this.repairEvent({
        eventId,
        apply: true,
        actorId: opts?.actorId,
      });
    } catch (e) {
      lastCleanupAt.delete(key);
      throw e;
    }
  }

  /**
   * Global cleanup: events with past-grace ACTIVE holds and/or counter drift
   * (stored quantityReserved ≠ SUM of keeper ACTIVE rows).
   */
  static async cleanupStaleReservations(opts?: {
    eventId?: string;
    force?: boolean;
    actorId?: string | null;
    limit?: number;
  }): Promise<{ events: ReservationRepairResult[]; skipped: number }> {
    if (opts?.eventId) {
      const result = await this.cleanupEventSafe(opts.eventId, {
        force: opts.force ?? true,
        actorId: opts.actorId,
      });
      return { events: result ? [result] : [], skipped: result ? 0 : 1 };
    }

    const now = new Date();
    const graceCutoff = new Date(now.getTime() - paymentGraceMinutes() * 60_000);
    const limit = opts?.limit ?? 50;

    const staleExpired = await prisma.ticketReservation.findMany({
      where: {
        status: ReservationStatus.ACTIVE,
        expiresAt: { lte: graceCutoff },
      },
      select: { eventId: true },
      distinct: ["eventId"],
      take: limit,
    });

    const driftRows = await prisma.$queryRaw<Array<{ eventId: string }>>`
      SELECT DISTINCT tt."eventId" as "eventId"
      FROM "TicketType" tt
      LEFT JOIN (
        SELECT "ticketTypeId", COALESCE(SUM(quantity), 0)::int AS active_sum
        FROM "TicketReservation"
        WHERE status = 'ACTIVE'
        GROUP BY "ticketTypeId"
      ) r ON r."ticketTypeId" = tt.id
      WHERE tt."quantityReserved" <> COALESCE(r.active_sum, 0)
      LIMIT ${limit}
    `;

    const eventIds = [
      ...new Set([
        ...staleExpired.map((r) => r.eventId),
        ...driftRows.map((r) => r.eventId),
      ]),
    ].slice(0, limit);

    const events: ReservationRepairResult[] = [];
    let skipped = 0;
    for (const eventId of eventIds) {
      try {
        const result = await this.cleanupEventSafe(eventId, {
          force: opts?.force ?? true,
          actorId: opts?.actorId,
        });
        if (result) events.push(result);
        else skipped++;
      } catch {
        skipped++;
      }
    }
    return { events, skipped };
  }

  /**
   * Atomically reserve tickets with row locking to prevent overselling.
   * Two concurrent buyers of the last ticket: only one succeeds.
   */
  static async reserve(input: {
    eventId: string;
    sessionId: string;
    items: { ticketTypeId: string; quantity: number }[];
  }) {
    if (!input.items.length) {
      throw new AppError("INVALID_ITEMS", "Ingen billetter valgt", 400);
    }
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        throw new AppError("INVALID_QUANTITY", "Ugyldig antall", 400);
      }
    }

    const expiresAt = new Date(Date.now() + this.ttlMinutes() * 60_000);

    // Correct drift before locks (throttled no-op; always repairs when mismatched)
    try {
      await this.ensureInventoryConsistent(input.eventId);
    } catch {
      // Fall through — in-transaction releaseExpired still runs
    }

    return prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw new AppError("EVENT_NOT_FOUND", "Arrangement ikke funnet", 404);
      if (event.status === EventStatus.CANCELLED) {
        throw new AppError("EVENT_CANCELLED", "Arrangementet er kansellert", 409);
      }
      if (
        event.status === EventStatus.DRAFT ||
        event.status === EventStatus.SCHEDULED ||
        event.status === EventStatus.COMPLETED
      ) {
        throw new AppError("EVENT_NOT_ON_SALE", "Arrangementet er ikke til salgs", 409);
      }
      if (event.salesPausedAt || event.status === EventStatus.PAUSED) {
        throw new AppError("SALES_PAUSED", "Salget er midlertidig satt på pause", 409);
      }
      const now = new Date();
      if (event.salesStartAt && event.salesStartAt > now) {
        throw new AppError("SALES_NOT_STARTED", "Salget har ikke startet", 409);
      }
      if (event.salesEndAt && event.salesEndAt < now) {
        throw new AppError("SALES_ENDED", "Salget er avsluttet", 409);
      }

      await this.releaseExpired(tx);

      // Release any previous active reservations for this session
      const previous = await tx.ticketReservation.findMany({
        where: { sessionId: input.sessionId, status: ReservationStatus.ACTIVE },
      });
      for (const prev of previous) {
        await tx.ticketReservation.update({
          where: { id: prev.id },
          data: { status: ReservationStatus.RELEASED },
        });
        await tx.ticketType.update({
          where: { id: prev.ticketTypeId },
          data: { quantityReserved: { decrement: prev.quantity } },
        });
      }

      const created = [];

      for (const item of input.items) {
        const locked = await tx.$queryRaw<
          {
            id: string;
            quantity_total: number;
            quantity_released: number;
            quantity_sold: number;
            quantity_reserved: number;
            event_id: string;
            min_per_order: number;
            max_per_order: number;
            is_publicly_purchasable: boolean;
            sales_start_at: Date | null;
            sales_end_at: Date | null;
            sales_paused_at: Date | null;
            price: number;
            service_fee: number | null;
          }[]
        >`
          SELECT id, "quantityTotal" as quantity_total, "quantityReleased" as quantity_released,
                 "quantitySold" as quantity_sold, "quantityReserved" as quantity_reserved,
                 "eventId" as event_id, "minPerOrder" as min_per_order, "maxPerOrder" as max_per_order,
                 "isPubliclyPurchasable" as is_publicly_purchasable,
                 "salesStartAt" as sales_start_at, "salesEndAt" as sales_end_at,
                 "salesPausedAt" as sales_paused_at, price, "serviceFee" as service_fee
          FROM "TicketType"
          WHERE id = ${item.ticketTypeId}
          FOR UPDATE
        `;

        const row = locked[0];
        if (!row) {
          throw new AppError("TICKET_TYPE_NOT_FOUND", `Billettype ikke funnet: ${item.ticketTypeId}`, 404);
        }
        if (row.event_id !== input.eventId) {
          throw new AppError("TICKET_TYPE_WRONG_EVENT", "Billettype tilhører ikke arrangementet", 400);
        }
        if (!row.is_publicly_purchasable) {
          throw new AppError(
            "FREE_TICKET_NOT_PUBLIC",
            "Denne billettypen kan ikke kjøpes offentlig",
            403
          );
        }
        if (row.sales_paused_at) {
          throw new AppError("SALES_PAUSED", "Salget er midlertidig satt på pause", 409);
        }
        if (row.sales_start_at && row.sales_start_at > now) {
          throw new AppError("SALES_NOT_STARTED", "Salget for denne billettypen har ikke startet", 409);
        }
        if (row.sales_end_at && row.sales_end_at < now) {
          throw new AppError("SALES_ENDED", "Salget for denne billettypen er avsluttet", 409);
        }
        if (item.quantity < row.min_per_order || item.quantity > row.max_per_order) {
          throw new AppError(
            "INVALID_QUANTITY",
            `Antall må være mellom ${row.min_per_order} og ${row.max_per_order}`,
            400
          );
        }

        // Inventory gate = currently released, not full capacity
        const available =
          row.quantity_released - row.quantity_sold - row.quantity_reserved;
        if (item.quantity > available) {
          throw new AppError(
            "TICKET_SOLD_OUT",
            available <= 0 ? "Billettypen er utsolgt" : `Kun ${available} billetter igjen`,
            409
          );
        }

        // Lock price at reservation time (admin changes do not affect this hold)
        const ttFull = await tx.ticketType.findUniqueOrThrow({
          where: { id: item.ticketTypeId },
          include: { priceTiers: true },
        });
        let lineSubtotal = 0;
        for (let i = 0; i < item.quantity; i++) {
          lineSubtotal += resolveUnitPrice(ttFull, i);
        }
        const unitPrice = Math.round(lineSubtotal / item.quantity);
        const feePer = row.service_fee ?? event.serviceFee ?? 0;
        const lineFee = feePer * item.quantity;

        await tx.ticketType.update({
          where: { id: item.ticketTypeId },
          data: { quantityReserved: { increment: item.quantity } },
        });

        const reservation = await tx.ticketReservation.create({
          data: {
            eventId: input.eventId,
            ticketTypeId: item.ticketTypeId,
            quantity: item.quantity,
            sessionId: input.sessionId,
            expiresAt,
            status: ReservationStatus.ACTIVE,
            unitPriceSnapshot: unitPrice,
            serviceFeeSnapshot: lineFee,
            lineTotalSnapshot: lineSubtotal + lineFee,
          },
        });
        created.push(reservation);
      }

      return { reservations: created, expiresAt };
    });
  }

  static async convertToOrder(sessionId: string, orderId: string, tx: Prisma.TransactionClient) {
    await tx.ticketReservation.updateMany({
      where: { sessionId, status: ReservationStatus.ACTIVE },
      data: { status: ReservationStatus.CONVERTED, orderId },
    });
  }
}
