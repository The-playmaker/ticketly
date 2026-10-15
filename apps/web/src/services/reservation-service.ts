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
function paymentGraceMinutes() {
  return Number(process.env.PAYMENT_GRACE_MINUTES ?? 15);
}

export class ReservationService {
  static ttlMinutes() {
    return Number(process.env.RESERVATION_TTL_MINUTES ?? 10);
  }

  /**
   * Release expired reservations and free reserved quantity.
   * Never release inventory tied to a PENDING order still within payment grace
   * (prevents oversale when webhook races cleanup).
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
      // Hold inventory if order is still awaiting payment within grace window
      if (
        res.orderId &&
        res.order &&
        res.order.paymentStatus === PaymentStatus.PENDING &&
        res.order.orderStatus === OrderStatus.PENDING &&
        res.expiresAt > graceCutoff
      ) {
        continue;
      }

      // Never release if order already paid (webhook may still be issuing tickets)
      if (res.order?.paymentStatus === PaymentStatus.PAID) {
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
