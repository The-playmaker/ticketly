import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, AuthorizationError } from "@/lib/auth/rbac";
import { writeAuditLog } from "@/lib/audit";

const EXPORT_TYPES = [
  "orders",
  "tickets",
  "attendees",
  "guestlist",
  "checkins",
  "refunds",
  "promos",
] as const;

type ExportType = (typeof EXPORT_TYPES)[number];

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const eventId = url.searchParams.get("eventId");
    const type = (url.searchParams.get("type") ?? "orders") as ExportType;
    const format = url.searchParams.get("format") ?? "csv";
    const status = url.searchParams.get("status");
    const ticketTypeId = url.searchParams.get("ticketTypeId");
    const promoCode = url.searchParams.get("promoCode");
    const checkInStatus = url.searchParams.get("checkIn");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const source = url.searchParams.get("source");

    if (!eventId) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }
    if (!EXPORT_TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid export type" }, { status: 400 });
    }

    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      globalRole: session.user.globalRole,
      isActive: true,
      memberships: session.user.memberships,
    };

    if (!canManageEvents(user, event.organizationId) && user.globalRole !== "SUPER_ADMIN") {
      throw new AuthorizationError();
    }

    // Door staff: no financial exports
    const membership = user.memberships?.find((m) => m.organizationId === event.organizationId);
    if (membership?.role === "DOOR_STAFF" && (type === "orders" || type === "refunds" || type === "promos")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const createdAtFilter =
      from || to
        ? {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          }
        : undefined;

    let rows: Record<string, string | number | null>[] = [];

    if (type === "orders") {
      const orders = await prisma.order.findMany({
        where: {
          eventId,
          ...(status ? { paymentStatus: status as never } : {}),
          ...(promoCode
            ? { promoCode: { code: { equals: promoCode, mode: "insensitive" } } }
            : {}),
          ...(source ? { utmSource: { equals: source, mode: "insensitive" } } : {}),
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        include: { promoCode: true, payments: { take: 1, orderBy: { createdAt: "desc" } } },
        orderBy: { createdAt: "desc" },
      });
      rows = orders.map((o) => ({
        orderNumber: o.orderNumber,
        email: o.customerEmail,
        name: `${o.customerFirstName} ${o.customerLastName}`,
        phone: o.customerPhone,
        totalOre: o.total,
        discountOre: o.discount,
        paymentStatus: o.paymentStatus,
        orderStatus: o.orderStatus,
        provider: o.payments[0]?.provider ?? "",
        paymentMethod: o.payments[0]?.paymentMethod ?? "",
        promoCode: o.promoCode?.code ?? "",
        utmSource: o.utmSource ?? "",
        createdAt: o.createdAt.toISOString(),
      }));
    } else if (type === "tickets" || type === "attendees") {
      const tickets = await prisma.ticket.findMany({
        where: {
          eventId,
          ...(ticketTypeId ? { ticketTypeId } : {}),
          ...(status ? { status: status as never } : {}),
          ...(checkInStatus === "checked_in" ? { status: "CHECKED_IN" } : {}),
          ...(checkInStatus === "not_checked_in" ? { status: { not: "CHECKED_IN" } } : {}),
        },
        include: { ticketType: true, order: true },
      });
      rows = tickets.map((t) => ({
        publicId: t.publicId,
        holderName: t.holderName,
        holderEmail: t.holderEmail,
        ticketType: t.ticketType.name,
        status: t.status,
        orderNumber: t.order.orderNumber,
        checkedInAt: t.checkedInAt?.toISOString() ?? "",
      }));
    } else if (type === "checkins") {
      const checkIns = await prisma.checkIn.findMany({
        where: { eventId },
        include: { ticket: true },
        orderBy: { checkedInAt: "desc" },
      });
      rows = checkIns.map((c) => ({
        result: c.result,
        checkedInAt: c.checkedInAt.toISOString(),
        ticketPublicId: c.ticket?.publicId ?? "",
        holderName: c.ticket?.holderName ?? "",
        isManual: c.isManual ? "yes" : "no",
      }));
    } else if (type === "guestlist") {
      const guests = await prisma.guestListEntry.findMany({ where: { eventId } });
      rows = guests.map((g) => ({
        name: g.name,
        email: g.email,
        phone: g.phone,
        partySize: g.partySize,
        comment: g.comment,
      }));
    } else if (type === "refunds") {
      const refunds = await prisma.refund.findMany({
        where: { order: { eventId } },
        include: { order: true, payment: true },
        orderBy: { createdAt: "desc" },
      });
      rows = refunds.map((r) => ({
        orderNumber: r.order.orderNumber,
        amountOre: r.amount,
        currency: r.currency,
        status: r.status,
        reason: r.reason,
        provider: r.payment?.provider ?? "",
        createdAt: r.createdAt.toISOString(),
      }));
    } else if (type === "promos") {
      const orders = await prisma.order.findMany({
        where: {
          eventId,
          promoCodeId: { not: null },
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        include: { promoCode: true },
        orderBy: { createdAt: "desc" },
      });
      rows = orders.map((o) => ({
        orderNumber: o.orderNumber,
        promoCode: o.promoCode?.code ?? "",
        discountOre: o.discount,
        totalOre: o.total,
        email: o.customerEmail,
        createdAt: o.createdAt.toISOString(),
      }));
    }

    await writeAuditLog({
      actorId: session.user.id,
      organizationId: event.organizationId,
      action: "EXPORT_CREATED",
      entityType: "Event",
      entityId: eventId,
      metadata: { type, format, rowCount: rows.length },
    });

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(type);
      if (rows[0]) {
        ws.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k, width: 20 }));
        rows.forEach((r) => ws.addRow(r));
      }
      const buffer = await wb.xlsx.writeBuffer();
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${event.slug}-${type}.xlsx"`,
        },
      });
    }

    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        headers
          .map((h) => {
            const v = r[h] ?? "";
            const s = String(v).replaceAll('"', '""');
            return `"${s}"`;
          })
          .join(",")
      ),
    ].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${event.slug}-${type}.csv"`,
      },
    });
  } catch (e) {
    const status = e instanceof AuthorizationError ? 403 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status });
  }
}
