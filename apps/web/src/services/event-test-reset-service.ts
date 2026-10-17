import { EventStatus, PaymentStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import {
  EVENT_TEST_DATA_RESET_ACTION,
  PRODUCTION_EVENT_RESET_CONFIRMATION,
  TEST_EVENT_RESET_CONFIRMATION,
  type EventTestResetCounts,
  type EventTestResetResult,
  type ProductionGateResult,
} from "@/lib/admin/event-test-reset";

export {
  EVENT_TEST_DATA_RESET_ACTION,
  PRODUCTION_EVENT_RESET_CONFIRMATION,
  TEST_EVENT_RESET_CONFIRMATION,
};
export type { EventTestResetCounts, EventTestResetResult, ProductionGateResult };

const PAID_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
  PaymentStatus.AUTHORIZED,
];

/** Statuses treated as “live” for the production gate (schema has no LIVE enum). */
const LIVE_STATUSES: EventStatus[] = [
  EventStatus.PUBLISHED,
  EventStatus.PAUSED,
  EventStatus.SOLD_OUT,
];

const TEST_EMAIL_DOMAIN_SUFFIXES = ["@example.com", "@test.local", "@ticketly.test"];
const TEST_EMAIL_LOCAL_MARKERS = ["test+", "demo+", "seed+"];

function isProductionOverrideEnvEnabled(): boolean {
  return process.env.ALLOW_PRODUCTION_EVENT_RESET === "true";
}

/**
 * Known test / seed customer markers — not treated as real production buyers.
 */
export function isTestCustomerEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (TEST_EMAIL_DOMAIN_SUFFIXES.some((s) => normalized.endsWith(s))) return true;
  const local = normalized.split("@")[0] ?? "";
  return TEST_EMAIL_LOCAL_MARKERS.some((m) => local.startsWith(m));
}

export function evaluateProductionGate(input: {
  eventStatus: EventStatus;
  paidRevenueOre: number;
  realCustomerPaidOrderCount: number;
  allowProductionOverride?: boolean;
  productionConfirmation?: string;
}): ProductionGateResult {
  const reasons: string[] = [];

  if (input.realCustomerPaidOrderCount > 0) {
    reasons.push(
      `${input.realCustomerPaidOrderCount} betalt(e) ordre med ekte kundee-post (ikke @example.com / kjente testmarkører)`
    );
  }

  const isLive = LIVE_STATUSES.includes(input.eventStatus);
  if (isLive && input.paidRevenueOre > 0) {
    reasons.push(
      `Arrangementstatus ${input.eventStatus} (live) med betalt omsetning ${input.paidRevenueOre} øre`
    );
  }

  const overrideAvailable = isProductionOverrideEnvEnabled();
  const overrideOk =
    Boolean(input.allowProductionOverride) &&
    overrideAvailable &&
    input.productionConfirmation === PRODUCTION_EVENT_RESET_CONFIRMATION;

  return {
    blocked: reasons.length > 0 && !overrideOk,
    reasons,
    overrideAvailable,
    requiresProductionConfirmation: reasons.length > 0,
  };
}

async function collectCounts(eventId: string): Promise<EventTestResetCounts> {
  const orders = await prisma.order.findMany({
    where: { eventId },
    select: {
      id: true,
      total: true,
      paymentStatus: true,
      customerEmail: true,
    },
  });
  const orderIds = orders.map((o) => o.id);

  const tickets = await prisma.ticket.findMany({
    where: { eventId },
    select: { id: true },
  });
  const ticketIds = tickets.map((t) => t.id);

  const [
    payments,
    refunds,
    reservations,
    checkIns,
    offlineCheckIns,
    webhookEvents,
    notificationLogs,
    analyticsEvents,
    orderSnapshots,
    walletPasses,
    ticketTypes,
  ] = await Promise.all([
    orderIds.length
      ? prisma.payment.count({ where: { orderId: { in: orderIds } } })
      : Promise.resolve(0),
    orderIds.length
      ? prisma.refund.count({ where: { orderId: { in: orderIds } } })
      : Promise.resolve(0),
    prisma.ticketReservation.count({ where: { eventId } }),
    prisma.checkIn.count({ where: { eventId } }),
    prisma.offlineCheckIn.count({ where: { eventId } }),
    orderIds.length
      ? prisma.webhookEvent.count({ where: { orderId: { in: orderIds } } })
      : Promise.resolve(0),
    prisma.notificationLog.count({
      where: {
        OR: [
          { eventId },
          ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
        ],
      },
    }),
    prisma.analyticsEvent.count({ where: { eventId } }),
    orderIds.length
      ? prisma.orderSnapshot.count({ where: { orderId: { in: orderIds } } })
      : Promise.resolve(0),
    ticketIds.length
      ? prisma.walletPass.count({ where: { ticketId: { in: ticketIds } } })
      : Promise.resolve(0),
    prisma.ticketType.findMany({
      where: { eventId },
      select: {
        id: true,
        name: true,
        quantitySold: true,
        quantityReserved: true,
        quantityReleased: true,
        quantityTotal: true,
        price: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const paidOrders = orders.filter((o) => PAID_STATUSES.includes(o.paymentStatus));
  const paidRevenueOre = paidOrders.reduce((sum, o) => sum + o.total, 0);
  const realCustomerPaidOrderCount = paidOrders.filter(
    (o) => !isTestCustomerEmail(o.customerEmail)
  ).length;

  return {
    orders: orders.length,
    payments,
    refunds,
    tickets: tickets.length,
    reservations,
    checkIns,
    offlineCheckIns,
    webhookEvents,
    notificationLogs,
    analyticsEvents,
    orderSnapshots,
    walletPasses,
    ticketTypes,
    paidRevenueOre,
    realCustomerPaidOrderCount,
  };
}

type Tx = Prisma.TransactionClient;

/**
 * Delete dependent sales/test rows for one event in safe FK order, then zero sold/reserved.
 * Preserves Event, TicketType allocation/price/config, and unrelated events/orgs.
 */
async function deleteEventSalesData(tx: Tx, eventId: string) {
  const orders = await tx.order.findMany({
    where: { eventId },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  const tickets = await tx.ticket.findMany({
    where: { eventId },
    select: { id: true },
  });
  const ticketIds = tickets.map((t) => t.id);

  await tx.checkIn.deleteMany({ where: { eventId } });
  await tx.offlineCheckIn.deleteMany({ where: { eventId } });

  if (ticketIds.length) {
    await tx.ticketTransfer.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await tx.walletPass.deleteMany({ where: { ticketId: { in: ticketIds } } });
  }

  await tx.ticket.deleteMany({ where: { eventId } });

  if (orderIds.length) {
    await tx.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderSnapshot.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.webhookEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  }

  await tx.notificationLog.deleteMany({
    where: {
      OR: [
        { eventId },
        ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
      ],
    },
  });

  await tx.ticketReservation.deleteMany({ where: { eventId } });
  await tx.analyticsEvent.deleteMany({ where: { eventId } });

  if (orderIds.length) {
    await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  await tx.ticketType.updateMany({
    where: { eventId },
    data: { quantitySold: 0, quantityReserved: 0 },
  });
}

export const EventTestResetService = {
  TEST_EVENT_RESET_CONFIRMATION,
  PRODUCTION_EVENT_RESET_CONFIRMATION,
  EVENT_TEST_DATA_RESET_ACTION,
  isTestCustomerEmail,
  evaluateProductionGate,

  async preview(eventId: string): Promise<EventTestResetResult> {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, status: true },
    });
    if (!event) throw new AppError("NOT_FOUND", "Arrangement ikke funnet", 404);

    const counts = await collectCounts(eventId);
    const productionGate = evaluateProductionGate({
      eventStatus: event.status,
      paidRevenueOre: counts.paidRevenueOre,
      realCustomerPaidOrderCount: counts.realCustomerPaidOrderCount,
    });

    return {
      dryRun: true,
      eventId: event.id,
      eventName: event.name,
      eventStatus: event.status,
      counts,
      productionGate,
      preserved: {
        event: true,
        quantityTotal: true,
        quantityReleased: true,
        price: true,
        eventConfig: true,
      },
    };
  },

  async reset(input: {
    eventId: string;
    actorId: string;
    dryRun: boolean;
    confirmation?: string;
    allowProductionOverride?: boolean;
    productionConfirmation?: string;
    ipAddress?: string | null;
  }): Promise<EventTestResetResult> {
    if (input.dryRun) {
      return this.preview(input.eventId);
    }

    if (input.confirmation !== TEST_EVENT_RESET_CONFIRMATION) {
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        `Bekreftelse mangler eller er feil. Skriv nøyaktig: ${TEST_EVENT_RESET_CONFIRMATION}`,
        400
      );
    }

    const event = await prisma.event.findUnique({
      where: { id: input.eventId },
      select: {
        id: true,
        name: true,
        status: true,
        organizationId: true,
      },
    });
    if (!event) throw new AppError("NOT_FOUND", "Arrangement ikke funnet", 404);

    const countsBefore = await collectCounts(event.id);
    const productionGate = evaluateProductionGate({
      eventStatus: event.status,
      paidRevenueOre: countsBefore.paidRevenueOre,
      realCustomerPaidOrderCount: countsBefore.realCustomerPaidOrderCount,
      allowProductionOverride: input.allowProductionOverride,
      productionConfirmation: input.productionConfirmation,
    });

    if (productionGate.blocked) {
      throw new AppError(
        "PRODUCTION_EVENT_RESET_BLOCKED",
        `Nullstilling blokkert: ${productionGate.reasons.join("; ")}. ` +
          `Sett ALLOW_PRODUCTION_EVENT_RESET=true, send allowProductionOverride=true, ` +
          `og bekreft med «${PRODUCTION_EVENT_RESET_CONFIRMATION}».`,
        409
      );
    }

    await prisma.$transaction(async (tx) => {
      await deleteEventSalesData(tx, event.id);
    });

    const countsAfter = await collectCounts(event.id);

    await writeAuditLog({
      actorId: input.actorId,
      organizationId: event.organizationId,
      action: EVENT_TEST_DATA_RESET_ACTION,
      entityType: "Event",
      entityId: event.id,
      ipAddress: input.ipAddress,
      metadata: {
        eventName: event.name,
        deleted: countsBefore,
        after: {
          orders: countsAfter.orders,
          tickets: countsAfter.tickets,
          reservations: countsAfter.reservations,
          ticketTypes: countsAfter.ticketTypes.map((t) => ({
            id: t.id,
            quantitySold: t.quantitySold,
            quantityReserved: t.quantityReserved,
            quantityReleased: t.quantityReleased,
            quantityTotal: t.quantityTotal,
            price: t.price,
          })),
        },
        productionOverrideUsed: Boolean(
          productionGate.requiresProductionConfirmation && input.allowProductionOverride
        ),
      },
    });

    return {
      dryRun: false,
      eventId: event.id,
      eventName: event.name,
      eventStatus: event.status,
      counts: countsAfter,
      deleted: countsBefore,
      productionGate: { ...productionGate, blocked: false },
      preserved: {
        event: true,
        quantityTotal: true,
        quantityReleased: true,
        price: true,
        eventConfig: true,
      },
    };
  },
};
