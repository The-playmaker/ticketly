import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, AuthorizationError } from "@/lib/auth/rbac";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const eventId = url.searchParams.get("eventId");
    const type = url.searchParams.get("type") ?? "orders";
    const format = url.searchParams.get("format") ?? "csv";

    if (!eventId) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
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

    let rows: Record<string, string | number | null>[] = [];

    if (type === "orders") {
      const orders = await prisma.order.findMany({
        where: { eventId },
        orderBy: { createdAt: "desc" },
      });
      rows = orders.map((o) => ({
        orderNumber: o.orderNumber,
        email: o.customerEmail,
        name: `${o.customerFirstName} ${o.customerLastName}`,
        totalOre: o.total,
        paymentStatus: o.paymentStatus,
        orderStatus: o.orderStatus,
        createdAt: o.createdAt.toISOString(),
      }));
    } else if (type === "tickets") {
      const tickets = await prisma.ticket.findMany({
        where: { eventId },
        include: { ticketType: true, order: true },
      });
      rows = tickets.map((t) => ({
        publicId: t.publicId,
        holderName: t.holderName,
        holderEmail: t.holderEmail,
        ticketType: t.ticketType.name,
        status: t.status,
        orderNumber: t.order.orderNumber,
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
    }

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
