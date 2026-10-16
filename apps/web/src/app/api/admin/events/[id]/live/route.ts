import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { jsonError, AppError } from "@/lib/api-error";
import { InventoryService } from "@/services/inventory-service";

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

    const recent = await prisma.order.findMany({
      where: { eventId: id, paymentStatus: "PAID" },
      orderBy: { paidAt: "desc" },
      take: 20,
      include: {
        items: { select: { name: true, quantity: true, total: true } },
      },
    });

    const checkedIn = await prisma.ticket.count({
      where: { eventId: id, status: "CHECKED_IN" },
    });
    const refunded = await prisma.ticket.count({
      where: { eventId: id, status: "REFUNDED" },
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayOrders = await prisma.order.findMany({
      where: {
        eventId: id,
        paymentStatus: "PAID",
        paidAt: { gte: startOfDay },
      },
      select: { total: true },
    });

    const pageViews = await prisma.analyticsEvent.count({
      where: { eventId: id, type: "PAGE_VIEW" },
    });
    const paidCount = await prisma.order.count({
      where: { eventId: id, paymentStatus: "PAID" },
    });
    const checkoutStarts = await prisma.analyticsEvent.count({
      where: { eventId: id, type: "CHECKOUT_STARTED" },
    });

    const gross = recent.length
      ? (
          await prisma.order.aggregate({
            where: { eventId: id, paymentStatus: "PAID" },
            _sum: { total: true, serviceFee: true },
          })
        )
      : { _sum: { total: 0, serviceFee: 0 } };

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
      refunded,
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
        grossRevenue: gross._sum.total ?? 0,
        serviceFees: gross._sum.serviceFee ?? 0,
        ticketsSold: inventory.sold,
        available: inventory.available,
        reserved: inventory.reserved,
      },
      funnel: {
        pageViews,
        checkoutStarts,
        paidOrders: paidCount,
        conversion:
          pageViews > 0 ? Math.round((paidCount / pageViews) * 1000) / 10 : null,
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
      })),
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    return jsonError(e);
  }
}
