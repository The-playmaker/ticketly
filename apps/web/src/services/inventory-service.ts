import { EventStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";

/**
 * INVARIANT — TicketType.quantitySold = current **active sold** inventory
 * (tickets still VALID / CHECKED_IN / TRANSFERRED).
 *
 * Refunds decrement quantitySold so
 *   available = released − sold − reserved
 * stays correct. Do **not** treat quantitySold as historical sales volume;
 * use Ticket counts / Order items / financial totals for that.
 */
export function getReleasedAvailable(tt: {
  quantityReleased: number;
  quantitySold: number;
  quantityReserved: number;
}) {
  return Math.max(0, tt.quantityReleased - tt.quantitySold - tt.quantityReserved);
}

export function getUnreleased(tt: { quantityTotal: number; quantityReleased: number }) {
  return Math.max(0, tt.quantityTotal - tt.quantityReleased);
}

export function minAllowedReleased(tt: {
  quantitySold: number;
  quantityReserved: number;
}) {
  return tt.quantitySold + tt.quantityReserved;
}

/**
 * Canonical inventory breakdown — single source of truth for admin/customer UI.
 * available = released − sold − reserved
 * unreleased = allocation − released
 */
export function inventorySnapshot(tt: {
  quantityTotal: number;
  quantityReleased: number;
  quantitySold: number;
  quantityReserved: number;
}) {
  return {
    allocation: tt.quantityTotal,
    released: tt.quantityReleased,
    sold: tt.quantitySold,
    reserved: tt.quantityReserved,
    available: getReleasedAvailable(tt),
    unreleased: getUnreleased(tt),
    committed: minAllowedReleased(tt),
  };
}

export function eventInventorySnapshot(
  capacity: number,
  types: Array<{
    quantityTotal: number;
    quantityReleased: number;
    quantitySold: number;
    quantityReserved: number;
  }>
) {
  const allocation = types.reduce((s, t) => s + t.quantityTotal, 0);
  const released = types.reduce((s, t) => s + t.quantityReleased, 0);
  const sold = types.reduce((s, t) => s + t.quantitySold, 0);
  const reserved = types.reduce((s, t) => s + t.quantityReserved, 0);
  return {
    capacity,
    allocation,
    released,
    sold,
    reserved,
    available: Math.max(0, released - sold - reserved),
    unreleased: Math.max(0, allocation - released),
  };
}

/** Domain error when reducing release below sold + active reservations */
export const INVENTORY_BELOW_COMMITTED = "INVENTORY_BELOW_COMMITTED";

export class InventoryService {
  /** Release additional tickets for sale (+N). Caps at quantityTotal. */
  static async releaseMore(input: {
    ticketTypeId: string;
    amount: number;
    actorId?: string;
  }) {
    if (!Number.isInteger(input.amount) || input.amount < 1) {
      throw new AppError("INVALID_AMOUNT", "Antall må være et positivt heltall", 400);
    }

    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "TicketType" WHERE id = ${input.ticketTypeId} FOR UPDATE
      `;
      if (!locked[0]) throw new AppError("NOT_FOUND", "Billettype ikke funnet", 404);

      const tt = await tx.ticketType.findUniqueOrThrow({
        where: { id: input.ticketTypeId },
        include: { event: true },
      });

      const room = tt.quantityTotal - tt.quantityReleased;
      if (input.amount > room) {
        throw new AppError(
          "RELEASE_EXCEEDS_CAPACITY",
          `Kan kun frigjøre ${room} billetter til (kapasitet ${tt.quantityTotal})`,
          400
        );
      }

      const updated = await tx.ticketType.update({
        where: { id: tt.id },
        data: { quantityReleased: { increment: input.amount } },
      });

      await writeAuditLog({
        actorId: input.actorId,
        organizationId: tt.event.organizationId,
        action: "INVENTORY_RELEASED",
        entityType: "TicketType",
        entityId: tt.id,
        metadata: {
          amount: input.amount,
          from: tt.quantityReleased,
          to: updated.quantityReleased,
          eventId: tt.eventId,
        },
      });

      return updated;
    });
  }

  /**
   * Reduce released inventory. Never below sold + active reservations.
   */
  static async reduceReleased(input: {
    ticketTypeId: string;
    newReleased: number;
    actorId?: string;
  }) {
    if (!Number.isInteger(input.newReleased) || input.newReleased < 0) {
      throw new AppError("INVALID_AMOUNT", "Ugyldig released-verdi", 400);
    }

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = ${input.ticketTypeId} FOR UPDATE`;
      const tt = await tx.ticketType.findUniqueOrThrow({
        where: { id: input.ticketTypeId },
        include: { event: true },
      });

      const min = minAllowedReleased(tt);
      if (input.newReleased < min) {
        throw new AppError(
          INVENTORY_BELOW_COMMITTED,
          `Kan ikke redusere under ${min} (solgt ${tt.quantitySold} + reservert ${tt.quantityReserved})`,
          409
        );
      }
      if (input.newReleased > tt.quantityTotal) {
        throw new AppError("RELEASE_EXCEEDS_CAPACITY", "Released kan ikke overstige total", 400);
      }

      const updated = await tx.ticketType.update({
        where: { id: tt.id },
        data: { quantityReleased: input.newReleased },
      });

      await writeAuditLog({
        actorId: input.actorId,
        organizationId: tt.event.organizationId,
        action: "INVENTORY_REDUCED",
        entityType: "TicketType",
        entityId: tt.id,
        metadata: {
          from: tt.quantityReleased,
          to: input.newReleased,
          eventId: tt.eventId,
        },
      });

      return updated;
    });
  }

  static async pauseEventSales(eventId: string, actorId?: string) {
    const event = await prisma.event.update({
      where: { id: eventId },
      data: {
        salesPausedAt: new Date(),
        status: EventStatus.PAUSED,
      },
    });
    await writeAuditLog({
      actorId,
      organizationId: event.organizationId,
      action: "SALES_PAUSED",
      entityType: "Event",
      entityId: eventId,
    });
    return event;
  }

  static async resumeEventSales(eventId: string, actorId?: string) {
    const event = await prisma.event.update({
      where: { id: eventId },
      data: {
        salesPausedAt: null,
        status: EventStatus.PUBLISHED,
      },
    });
    await writeAuditLog({
      actorId,
      organizationId: event.organizationId,
      action: "SALES_RESUMED",
      entityType: "Event",
      entityId: eventId,
    });
    return event;
  }

  static async pauseTicketType(ticketTypeId: string, actorId?: string) {
    const tt = await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { salesPausedAt: new Date() },
      include: { event: true },
    });
    await writeAuditLog({
      actorId,
      organizationId: tt.event.organizationId,
      action: "TICKET_TYPE_PAUSED",
      entityType: "TicketType",
      entityId: ticketTypeId,
    });
    return tt;
  }

  static async resumeTicketType(ticketTypeId: string, actorId?: string) {
    const tt = await prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { salesPausedAt: null },
      include: { event: true },
    });
    await writeAuditLog({
      actorId,
      organizationId: tt.event.organizationId,
      action: "TICKET_TYPE_RESUMED",
      entityType: "TicketType",
      entityId: ticketTypeId,
    });
    return tt;
  }

  /** Change price for NEW reservations only. Existing reservations keep snapshot. */
  static async changePrice(input: {
    ticketTypeId: string;
    newPrice: number;
    reason?: string;
    actorId?: string;
  }) {
    if (!Number.isInteger(input.newPrice) || input.newPrice < 0) {
      throw new AppError("INVALID_PRICE", "Ugyldig pris", 400);
    }

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = ${input.ticketTypeId} FOR UPDATE`;
      const tt = await tx.ticketType.findUniqueOrThrow({
        where: { id: input.ticketTypeId },
        include: { event: true },
      });
      const oldPrice = tt.price;
      if (oldPrice === input.newPrice) return tt;

      const updated = await tx.ticketType.update({
        where: { id: tt.id },
        data: { price: input.newPrice },
      });

      await tx.priceHistory.create({
        data: {
          ticketTypeId: tt.id,
          oldPrice,
          newPrice: input.newPrice,
          changedById: input.actorId,
          reason: input.reason,
        },
      });

      await writeAuditLog({
        actorId: input.actorId,
        organizationId: tt.event.organizationId,
        action: "PRICE_CHANGED",
        entityType: "TicketType",
        entityId: tt.id,
        metadata: {
          oldPrice,
          newPrice: input.newPrice,
          reason: input.reason,
          eventId: tt.eventId,
        },
      });

      return updated;
    });
  }

  static async getEventInventorySummary(eventId: string) {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: { ticketTypes: true },
    });
    const types = event.ticketTypes.map((tt) => ({
      id: tt.id,
      name: tt.name,
      price: tt.price,
      quantityTotal: tt.quantityTotal,
      quantityReleased: tt.quantityReleased,
      quantitySold: tt.quantitySold,
      quantityReserved: tt.quantityReserved,
      available: getReleasedAvailable(tt),
      unreleased: getUnreleased(tt),
      paused: Boolean(tt.salesPausedAt),
    }));
    return {
      eventId,
      capacity: event.capacity,
      salesPaused: Boolean(event.salesPausedAt) || event.status === EventStatus.PAUSED,
      status: event.status,
      types,
      sold: types.reduce((s, t) => s + t.quantitySold, 0),
      reserved: types.reduce((s, t) => s + t.quantityReserved, 0),
      available: types.reduce((s, t) => s + t.available, 0),
      released: types.reduce((s, t) => s + t.quantityReleased, 0),
    };
  }
}

void (0 as unknown as Prisma.TicketTypeUpdateInput);
