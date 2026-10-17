import { PaymentStatus, TicketStatus, type PrismaClient } from "@prisma/client";

/**
 * Orders that once reached a paid capture — including later full/partial refunds.
 * Prefer `paidAt IS NOT NULL` (set on markOrderPaid, never cleared). Status fallback
 * covers legacy rows that may lack paidAt.
 */
export const GROSS_SALES_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/** Tickets that still count as active sold inventory (not refunded/cancelled). */
export const ACTIVE_SOLD_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.VALID,
  TicketStatus.CHECKED_IN,
  TicketStatus.TRANSFERRED,
];

export type EventFinancialTotals = {
  /** Sum of original order.total for orders that reached paid (incl. later refunded). */
  grossSales: number;
  /** Sum of Refund.amount where status=SUCCEEDED — source of truth for refund money. */
  successfulRefundAmount: number;
  /** grossSales − successfulRefundAmount */
  netRevenue: number;
  /** Ticket.status=REFUNDED count */
  refundedTicketCount: number;
  /** VALID | CHECKED_IN | TRANSFERRED count */
  activeSoldTicketCount: number;
  /** Orders that reached paid (for funnel / AOV denominators). */
  paidOrderCount: number;
  serviceFees: number;
};

/** Pure net helper — partial refunds reduce net by refunded amount only. */
export function computeNetRevenue(grossSales: number, successfulRefundAmount: number): number {
  return grossSales - successfulRefundAmount;
}

/**
 * Pure aggregation for tests / offline use.
 * Gross = sum of order totals that ever paid; refunds = sum SUCCEEDED amounts only.
 */
export function aggregateFinancialTotals(input: {
  orders: Array<{ total: number; serviceFee?: number; paidAt: Date | null; paymentStatus: PaymentStatus }>;
  refunds: Array<{ amount: number; status: string }>;
  tickets: Array<{ status: TicketStatus | string }>;
}): EventFinancialTotals {
  const everPaid = input.orders.filter(
    (o) =>
      o.paidAt != null || GROSS_SALES_PAYMENT_STATUSES.includes(o.paymentStatus)
  );
  const grossSales = everPaid.reduce((s, o) => s + o.total, 0);
  const serviceFees = everPaid.reduce((s, o) => s + (o.serviceFee ?? 0), 0);
  const successfulRefundAmount = input.refunds
    .filter((r) => r.status === "SUCCEEDED")
    .reduce((s, r) => s + r.amount, 0);
  const refundedTicketCount = input.tickets.filter((t) => t.status === TicketStatus.REFUNDED).length;
  const activeSoldTicketCount = input.tickets.filter((t) =>
    ACTIVE_SOLD_TICKET_STATUSES.includes(t.status as TicketStatus)
  ).length;

  return {
    grossSales,
    successfulRefundAmount,
    netRevenue: computeNetRevenue(grossSales, successfulRefundAmount),
    refundedTicketCount,
    activeSoldTicketCount,
    paidOrderCount: everPaid.length,
    serviceFees,
  };
}

type Db = Pick<PrismaClient, "order" | "refund" | "ticket">;

/** Per-event financial reporting used by live ops dashboard and analytics. */
export async function getEventFinancialTotals(
  db: Db,
  eventId: string
): Promise<EventFinancialTotals> {
  const [grossAgg, refundAgg, refundedTicketCount, activeSoldTicketCount, paidOrderCount] =
    await Promise.all([
      db.order.aggregate({
        where: {
          eventId,
          OR: [
            { paidAt: { not: null } },
            { paymentStatus: { in: GROSS_SALES_PAYMENT_STATUSES } },
          ],
        },
        _sum: { total: true, serviceFee: true },
        _count: true,
      }),
      db.refund.aggregate({
        where: { order: { eventId }, status: "SUCCEEDED" },
        _sum: { amount: true },
      }),
      db.ticket.count({ where: { eventId, status: TicketStatus.REFUNDED } }),
      db.ticket.count({
        where: { eventId, status: { in: ACTIVE_SOLD_TICKET_STATUSES } },
      }),
      db.order.count({
        where: {
          eventId,
          OR: [
            { paidAt: { not: null } },
            { paymentStatus: { in: GROSS_SALES_PAYMENT_STATUSES } },
          ],
        },
      }),
    ]);

  const grossSales = grossAgg._sum.total ?? 0;
  const successfulRefundAmount = refundAgg._sum.amount ?? 0;

  return {
    grossSales,
    successfulRefundAmount,
    netRevenue: computeNetRevenue(grossSales, successfulRefundAmount),
    refundedTicketCount,
    activeSoldTicketCount,
    paidOrderCount,
    serviceFees: grossAgg._sum.serviceFee ?? 0,
  };
}

/** Org-scoped (or platform-wide when organizationId is null) financial totals. */
export async function getOrgFinancialTotals(
  db: Db,
  organizationId: string | null
): Promise<
  Pick<
    EventFinancialTotals,
    "grossSales" | "successfulRefundAmount" | "netRevenue" | "paidOrderCount" | "serviceFees"
  >
> {
  const orgFilter = organizationId ? { organizationId } : {};
  const [grossAgg, refundAgg] = await Promise.all([
    db.order.aggregate({
      where: {
        ...orgFilter,
        OR: [
          { paidAt: { not: null } },
          { paymentStatus: { in: GROSS_SALES_PAYMENT_STATUSES } },
        ],
      },
      _sum: { total: true, serviceFee: true },
      _count: true,
    }),
    db.refund.aggregate({
      where: { order: orgFilter, status: "SUCCEEDED" },
      _sum: { amount: true },
    }),
  ]);

  const grossSales = grossAgg._sum.total ?? 0;
  const successfulRefundAmount = refundAgg._sum.amount ?? 0;

  return {
    grossSales,
    successfulRefundAmount,
    netRevenue: computeNetRevenue(grossSales, successfulRefundAmount),
    paidOrderCount: grossAgg._count,
    serviceFees: grossAgg._sum.serviceFee ?? 0,
  };
}
