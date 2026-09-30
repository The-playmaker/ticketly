import {
  ReservationStatus,
  type Prisma,
  type TicketType,
  type TicketPriceTier,
} from "@prisma/client";
import { prisma } from "@/lib/db";

export type TicketTypeWithTiers = TicketType & { priceTiers: TicketPriceTier[] };

export function getAvailableQuantity(tt: Pick<TicketType, "quantityTotal" | "quantitySold" | "quantityReserved">) {
  return Math.max(0, tt.quantityTotal - tt.quantitySold - tt.quantityReserved);
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

export class ReservationService {
  static ttlMinutes() {
    return Number(process.env.RESERVATION_TTL_MINUTES ?? 10);
  }

  /** Release expired reservations and free reserved quantity */
  static async releaseExpired(tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;
    const now = new Date();
    const expired = await db.ticketReservation.findMany({
      where: { status: ReservationStatus.ACTIVE, expiresAt: { lt: now } },
    });

    for (const res of expired) {
      await db.ticketReservation.update({
        where: { id: res.id },
        data: { status: ReservationStatus.EXPIRED },
      });
      await db.ticketType.update({
        where: { id: res.ticketTypeId },
        data: { quantityReserved: { decrement: res.quantity } },
      });
    }

    return expired.length;
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
    const expiresAt = new Date(Date.now() + this.ttlMinutes() * 60_000);

    return prisma.$transaction(async (tx) => {
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
        // Lock ticket type row (FOR UPDATE) via raw query
        const locked = await tx.$queryRaw<
          { id: string; quantity_total: number; quantity_sold: number; quantity_reserved: number; event_id: string; min_per_order: number; max_per_order: number }[]
        >`
          SELECT id, "quantityTotal" as quantity_total, "quantitySold" as quantity_sold,
                 "quantityReserved" as quantity_reserved, "eventId" as event_id,
                 "minPerOrder" as min_per_order, "maxPerOrder" as max_per_order
          FROM "TicketType"
          WHERE id = ${item.ticketTypeId}
          FOR UPDATE
        `;

        const row = locked[0];
        if (!row) {
          throw new Error(`Billettype ikke funnet: ${item.ticketTypeId}`);
        }
        if (row.event_id !== input.eventId) {
          throw new Error("Billettype tilhører ikke arrangementet");
        }
        if (item.quantity < row.min_per_order || item.quantity > row.max_per_order) {
          throw new Error(
            `Antall må være mellom ${row.min_per_order} og ${row.max_per_order}`
          );
        }

        const available =
          row.quantity_total - row.quantity_sold - row.quantity_reserved;
        if (item.quantity > available) {
          throw new Error(
            available <= 0
              ? "Billettypen er utsolgt"
              : `Kun ${available} billetter igjen`
          );
        }

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
