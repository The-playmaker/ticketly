import { PaymentStatus, TicketStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import {
  EMERGENCY_EVENT_RESET_CONFIRMATION,
  EVENT_TEST_DATA_RESET_ACTION,
  PRODUCTION_EVENT_RESET_CONFIRMATION,
  TEST_EVENT_RESET_CONFIRMATION,
  UNSETTLED_FINANCIAL_STATUSES,
  type EventTestResetCounts,
  type EventTestResetResult,
  type SafetyGateResult,
} from "@/lib/admin/event-test-reset";

export {
  EMERGENCY_EVENT_RESET_CONFIRMATION,
  EVENT_TEST_DATA_RESET_ACTION,
  PRODUCTION_EVENT_RESET_CONFIRMATION,
  TEST_EVENT_RESET_CONFIRMATION,
  UNSETTLED_FINANCIAL_STATUSES,
};
export type { EventTestResetCounts, EventTestResetResult, SafetyGateResult };
/** @deprecated Use SafetyGateResult */
export type { SafetyGateResult as ProductionGateResult };

const UNSETTLED: PaymentStatus[] = UNSETTLED_FINANCIAL_STATUSES.map(
  (s) => PaymentStatus[s as keyof typeof PaymentStatus]
);

function isEmergencyOverrideEnvEnabled(): boolean {
  return process.env.ALLOW_PRODUCTION_EVENT_RESET === "true";
}

/**
 * Primary safety gate: all financial orders must be fully refunded.
 * Does not issue refunds — Stripe remains source of record.
 *
 * Emergency bypass (documented, off by default):
 * ALLOW_PRODUCTION_EVENT_RESET=true + allowEmergencyOverride +
 * emergencyConfirmation === EMERGENCY_EVENT_RESET_CONFIRMATION
 */
export function evaluateFinancialSafetyGate(input: {
  unsettledByStatus: Partial<Record<string, number>>;
  allowEmergencyOverride?: boolean;
  emergencyConfirmation?: string;
}): SafetyGateResult {
  const reasons: string[] = [];
  let unsettledTotal = 0;

  for (const status of UNSETTLED_FINANCIAL_STATUSES) {
    const n = input.unsettledByStatus[status] ?? 0;
    if (n > 0) {
      unsettledTotal += n;
      reasons.push(`${n} ordre med status ${status}`);
    }
  }

  // Catch any unexpected non-terminal financial statuses not in the known list
  for (const [status, n] of Object.entries(input.unsettledByStatus)) {
    if (
      n &&
      n > 0 &&
      !(UNSETTLED_FINANCIAL_STATUSES as readonly string[]).includes(status)
    ) {
      unsettledTotal += n;
      reasons.push(`${n} økonomisk uavklart(e) ordre med status ${status}`);
    }
  }

  if (unsettledTotal > 0 && reasons.length === 0) {
    reasons.push(`${unsettledTotal} økonomisk uavklart(e) ordre`);
  }

  const overrideAvailable = isEmergencyOverrideEnvEnabled();
  const overrideOk =
    Boolean(input.allowEmergencyOverride) &&
    overrideAvailable &&
    input.emergencyConfirmation === EMERGENCY_EVENT_RESET_CONFIRMATION;

  return {
    blocked: reasons.length > 0 && !overrideOk,
    reasons,
    unsettledByStatus: input.unsettledByStatus,
    overrideAvailable,
    requiresEmergencyConfirmation: reasons.length > 0,
  };
}

/** @deprecated Use evaluateFinancialSafetyGate */
export function evaluateProductionGate(input: {
  unsettledByStatus?: Partial<Record<string, number>>;
  eventStatus?: unknown;
  paidRevenueOre?: number;
  realCustomerPaidOrderCount?: number;
  allowProductionOverride?: boolean;
  productionConfirmation?: string;
  allowEmergencyOverride?: boolean;
  emergencyConfirmation?: string;
}): SafetyGateResult {
  if (input.unsettledByStatus) {
    return evaluateFinancialSafetyGate({
      unsettledByStatus: input.unsettledByStatus,
      allowEmergencyOverride:
        input.allowEmergencyOverride ?? input.allowProductionOverride,
      emergencyConfirmation:
        input.emergencyConfirmation ?? input.productionConfirmation,
    });
  }
  // Legacy shape → treat paid real customers / live revenue as unsettled PAID
  const unsettledByStatus: Partial<Record<string, number>> = {};
  const paidLike =
    (input.realCustomerPaidOrderCount ?? 0) > 0 || (input.paidRevenueOre ?? 0) > 0
      ? Math.max(input.realCustomerPaidOrderCount ?? 0, input.paidRevenueOre ? 1 : 0)
      : 0;
  if (paidLike > 0) unsettledByStatus.PAID = paidLike;
  return evaluateFinancialSafetyGate({
    unsettledByStatus,
    allowEmergencyOverride:
      input.allowEmergencyOverride ?? input.allowProductionOverride,
    emergencyConfirmation:
      input.emergencyConfirmation ?? input.productionConfirmation,
  });
}

async function collectCounts(eventId: string): Promise<EventTestResetCounts> {
  const orders = await prisma.order.findMany({
    where: { eventId },
    select: {
      id: true,
      paymentStatus: true,
      promoCodeId: true,
    },
  });
  const orderIds = orders.map((o) => o.id);

  const tickets = await prisma.ticket.findMany({
    where: { eventId },
    select: { id: true, status: true, checkedInAt: true },
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
    waitlistEntries,
    reminderJobs,
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
    prisma.waitlistEntry.count({ where: { eventId } }),
    prisma.eventReminderJob.count({ where: { eventId } }),
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

  const paidOrders = orders.filter((o) => o.paymentStatus === PaymentStatus.PAID).length;
  const refundedOrders = orders.filter(
    (o) => o.paymentStatus === PaymentStatus.REFUNDED
  ).length;
  const unsettledOrders = orders.filter((o) => UNSETTLED.includes(o.paymentStatus)).length;

  return {
    orders: orders.length,
    paidOrders,
    refundedOrders,
    unsettledOrders,
    payments,
    refunds,
    tickets: tickets.length,
    refundedTickets: tickets.filter((t) => t.status === TicketStatus.REFUNDED).length,
    checkedInTickets: tickets.filter(
      (t) => t.status === TicketStatus.CHECKED_IN || t.checkedInAt != null
    ).length,
    reservations,
    checkIns,
    offlineCheckIns,
    webhookEvents,
    notificationLogs,
    analyticsEvents,
    orderSnapshots,
    walletPasses,
    waitlistEntries,
    reminderJobs,
    promoUsages: orders.filter((o) => o.promoCodeId != null).length,
    ticketTypes,
  };
}

function unsettledByStatusFromOrders(
  orders: Array<{ paymentStatus: PaymentStatus }>
): Partial<Record<string, number>> {
  const map: Partial<Record<string, number>> = {};
  for (const o of orders) {
    if (UNSETTLED.includes(o.paymentStatus)) {
      map[o.paymentStatus] = (map[o.paymentStatus] ?? 0) + 1;
    }
  }
  return map;
}

type Tx = Prisma.TransactionClient;

/**
 * Delete dependent sales/test rows for one event in safe FK order, then zero sold/reserved.
 * Preserves Event, TicketType allocation/price/config, Stripe externally, and unrelated events/orgs.
 * Does not issue refunds.
 */
async function deleteEventSalesData(tx: Tx, eventId: string) {
  const orders = await tx.order.findMany({
    where: { eventId },
    select: { id: true, promoCodeId: true },
  });
  const orderIds = orders.map((o) => o.id);

  const tickets = await tx.ticket.findMany({
    where: { eventId },
    select: { id: true },
  });
  const ticketIds = tickets.map((t) => t.id);

  // Promo usage counters attributable to these orders (do not delete PromoCode rows)
  const promoDecrements = new Map<string, number>();
  for (const o of orders) {
    if (o.promoCodeId) {
      promoDecrements.set(o.promoCodeId, (promoDecrements.get(o.promoCodeId) ?? 0) + 1);
    }
  }

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

  await tx.eventReminderJob.deleteMany({ where: { eventId } });
  await tx.ticketReservation.deleteMany({ where: { eventId } });
  await tx.analyticsEvent.deleteMany({ where: { eventId } });
  await tx.waitlistEntry.deleteMany({ where: { eventId } });

  if (orderIds.length) {
    await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  for (const [promoCodeId, decrement] of promoDecrements) {
    const promo = await tx.promoCode.findUnique({
      where: { id: promoCodeId },
      select: { usedCount: true },
    });
    if (!promo) continue;
    await tx.promoCode.update({
      where: { id: promoCodeId },
      data: { usedCount: Math.max(0, promo.usedCount - decrement) },
    });
  }

  await tx.ticketType.updateMany({
    where: { eventId },
    data: { quantitySold: 0, quantityReserved: 0 },
  });
}

function toResult(input: {
  dryRun: boolean;
  event: { id: string; name: string; status: string; organizationId: string };
  organizationName: string;
  counts: EventTestResetCounts;
  safetyGate: SafetyGateResult;
  deleted?: EventTestResetCounts;
}): EventTestResetResult {
  return {
    dryRun: input.dryRun,
    eventId: input.event.id,
    eventName: input.event.name,
    eventStatus: input.event.status,
    organizationId: input.event.organizationId,
    organizationName: input.organizationName,
    counts: input.counts,
    safetyGate: input.safetyGate,
    productionGate: input.safetyGate,
    deleted: input.deleted,
    preserved: {
      event: true,
      quantityTotal: true,
      quantityReleased: true,
      price: true,
      eventConfig: true,
      stripeExternal: true,
    },
  };
}

export const EventTestResetService = {
  TEST_EVENT_RESET_CONFIRMATION,
  EMERGENCY_EVENT_RESET_CONFIRMATION,
  PRODUCTION_EVENT_RESET_CONFIRMATION,
  EVENT_TEST_DATA_RESET_ACTION,
  evaluateFinancialSafetyGate,
  evaluateProductionGate,

  async preview(eventId: string): Promise<EventTestResetResult> {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        status: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    });
    if (!event) throw new AppError("NOT_FOUND", "Arrangement ikke funnet", 404);

    const orders = await prisma.order.findMany({
      where: { eventId },
      select: { paymentStatus: true },
    });
    const counts = await collectCounts(eventId);
    const safetyGate = evaluateFinancialSafetyGate({
      unsettledByStatus: unsettledByStatusFromOrders(orders),
    });

    return toResult({
      dryRun: true,
      event: event,
      organizationName: event.organization.name,
      counts,
      safetyGate,
    });
  },

  async reset(input: {
    eventId: string;
    actorId: string;
    dryRun?: boolean;
    confirmation?: string;
    /** Preferred body field name from API: confirm */
    confirm?: string;
    allowEmergencyOverride?: boolean;
    emergencyConfirmation?: string;
    /** @deprecated aliases */
    allowProductionOverride?: boolean;
    productionConfirmation?: string;
    ipAddress?: string | null;
  }): Promise<EventTestResetResult> {
    if (input.dryRun) {
      return this.preview(input.eventId);
    }

    const confirmation = input.confirm ?? input.confirmation;
    if (confirmation !== TEST_EVENT_RESET_CONFIRMATION) {
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
        organization: { select: { name: true } },
      },
    });
    if (!event) throw new AppError("NOT_FOUND", "Arrangement ikke funnet", 404);

    const ordersBefore = await prisma.order.findMany({
      where: { eventId: event.id },
      select: { paymentStatus: true },
    });
    const countsBefore = await collectCounts(event.id);
    const ticketTypesBefore = countsBefore.ticketTypes.map((t) => ({
      id: t.id,
      name: t.name,
      quantitySold: t.quantitySold,
      quantityReserved: t.quantityReserved,
      quantityReleased: t.quantityReleased,
      quantityTotal: t.quantityTotal,
      price: t.price,
    }));

    const safetyGate = evaluateFinancialSafetyGate({
      unsettledByStatus: unsettledByStatusFromOrders(ordersBefore),
      allowEmergencyOverride:
        input.allowEmergencyOverride ?? input.allowProductionOverride,
      emergencyConfirmation:
        input.emergencyConfirmation ?? input.productionConfirmation,
    });

    if (safetyGate.blocked) {
      throw new AppError(
        "EVENT_RESET_BLOCKED_UNREFUNDED",
        `Nullstilling blokkert: alle økonomiske ordre må være fullt refundert først. ` +
          `${safetyGate.reasons.join("; ")}. ` +
          `Reset utsteder ikke refusjoner — gjennomfør refusjon i Stripe/admin først. ` +
          (safetyGate.overrideAvailable
            ? `Nødoverstyring: send allowEmergencyOverride=true og emergencyConfirmation «${EMERGENCY_EVENT_RESET_CONFIRMATION}» (krever ALLOW_PRODUCTION_EVENT_RESET=true).`
            : `Nødoverstyring er ikke aktivert (ALLOW_PRODUCTION_EVENT_RESET).`),
        409
      );
    }

    await prisma.$transaction(async (tx) => {
      await deleteEventSalesData(tx, event.id);
    });

    const countsAfter = await collectCounts(event.id);
    const ticketTypesAfter = countsAfter.ticketTypes.map((t) => ({
      id: t.id,
      name: t.name,
      quantitySold: t.quantitySold,
      quantityReserved: t.quantityReserved,
      quantityReleased: t.quantityReleased,
      quantityTotal: t.quantityTotal,
      price: t.price,
    }));

    const emergencyOverrideUsed = Boolean(
      safetyGate.requiresEmergencyConfirmation &&
        (input.allowEmergencyOverride ?? input.allowProductionOverride)
    );

    await writeAuditLog({
      actorId: input.actorId,
      organizationId: event.organizationId,
      action: EVENT_TEST_DATA_RESET_ACTION,
      entityType: "Event",
      entityId: event.id,
      ipAddress: input.ipAddress,
      metadata: {
        eventId: event.id,
        eventName: event.name,
        actorId: input.actorId,
        timestamp: new Date().toISOString(),
        deleted: countsBefore,
        countsDeleted: countsBefore,
        ticketTypeCountersBefore: ticketTypesBefore,
        ticketTypeCountersAfter: ticketTypesAfter,
        after: {
          orders: countsAfter.orders,
          tickets: countsAfter.tickets,
          reservations: countsAfter.reservations,
          ticketTypes: ticketTypesAfter,
        },
        emergencyOverrideUsed,
        productionOverrideUsed: emergencyOverrideUsed,
      },
    });

    return toResult({
      dryRun: false,
      event,
      organizationName: event.organization.name,
      counts: countsAfter,
      safetyGate: { ...safetyGate, blocked: false },
      deleted: countsBefore,
    });
  },
};
