import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { jsonError, AppError } from "@/lib/api-error";
import { InventoryService } from "@/services/inventory-service";
import {
  getEventFinancialTotals,
  GROSS_SALES_PAYMENT_STATUSES,
} from "@/lib/admin/event-financials";

type Props = { params: Promise<{ id: string }> };

/** Polling endpoint for live sales feed (5–15s client refresh). No PII. */
export async function GET(_req: Request, { params }: Props) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session?.user) throw new AppError("UNAUTHORIZED", "Innlogging kreves", 401);

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) throw new AppError("NOT_FOUND", "Ikke funnet", 404);

    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: true,
      memberships: session.user.memberships,
    };
    if (!canManageEvents(user, event.organizationId) && !isSuperAdmin(user)) {
      throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
    }

    const inventory = await InventoryService.getEventInventorySummary(id);
    const financials = await getEventFinancialTotals(prisma, id);

    const recent = await prisma.order.findMany({
      where: {
        eventId: id,
        OR: [
          { paidAt: { not: null } },
          { paymentStatus: { in: GROSS_SALES_PAYMENT_STATUSES } },
        ],
      },
      orderBy: { paidAt: "desc" },
      take: 20,
      include: {
        items: { select: { name: true, quantity: true, total: true } },
      },
    });

    const checkedIn = await prisma.ticket.count({
      where: { eventId: id, status: "CHECKED_IN" },
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayOrders = await prisma.order.findMany({
      where: {
        eventId: id,
        paidAt: { gte: startOfDay },
        OR: [
          { paidAt: { not: null } },
          { paymentStatus: { in: GROSS_SALES_PAYMENT_STATUSES } },
        ],
      },
      select: { total: true },
    });

    const pageViews = await prisma.analyticsEvent.count({
      where: { eventId: id, type: "PAGE_VIEW" },
    });
    const checkoutStarts = await prisma.analyticsEvent.count({
      where: { eventId: id, type: "CHECKOUT_STARTED" },
    });

    const [waitlistWaiting, topPromo, bundleSold, remindersScheduled] = await Promise.all([
      prisma.waitlistEntry.count({ where: { eventId: id, status: "WAITING" } }),
      prisma.promoCode.findFirst({
        where: {
          organizationId: event.organizationId,
          OR: [{ eventId: id }, { eventId: null }],
          usedCount: { gt: 0 },
        },
        orderBy: { usedCount: "desc" },
        select: { code: true, usedCount: true },
      }),
      prisma.ticketType.findFirst({
        where: { eventId: id, isBundle: true },
        orderBy: { quantitySold: "desc" },
        select: { name: true, quantitySold: true },
      }),
      prisma.eventReminderJob.count({
        where: { eventId: id, status: "SCHEDULED" },
      }),
    ]);

    return NextResponse.json({
      inventory,
      checkedIn,
      /** @deprecated Prefer totals.refundedTicketCount — kept for older clients */
      refunded: financials.refundedTicketCount,
      parity: {
        waitlistWaiting,
        promo: topPromo,
        bundle: bundleSold,
        remindersScheduled,
      },
      today: {
        revenue: todayOrders.reduce((s, o) => s + o.total, 0),
        orders: todayOrders.length,
      },
      totals: {
        grossSales: financials.grossSales,
        /** @deprecated Alias — use grossSales */
        grossRevenue: financials.grossSales,
        successfulRefundAmount: financials.successfulRefundAmount,
        netRevenue: financials.netRevenue,
        serviceFees: financials.serviceFees,
        /** Active sold = quantitySold inventory (VALID/CHECKED_IN/TRANSFERRED). */
        ticketsSold: inventory.sold,
        activeSoldTickets: financials.activeSoldTicketCount,
        refundedTicketCount: financials.refundedTicketCount,
        available: inventory.available,
        reserved: inventory.reserved,
      },
      funnel: {
        pageViews,
        checkoutStarts,
        paidOrders: financials.paidOrderCount,
        conversion:
          pageViews > 0
            ? Math.round((financials.paidOrderCount / pageViews) * 1000) / 10
            : null,
      },
      feed: recent.map((o) => ({
        at: o.paidAt ?? o.createdAt,
        lines: o.items.map((i) => ({
          quantity: i.quantity,
          name: i.name,
          total: i.total,
        })),
        total: o.total,
        currency: o.currency,
        paymentStatus: o.paymentStatus,
      })),
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    return jsonError(e);
  }
}
