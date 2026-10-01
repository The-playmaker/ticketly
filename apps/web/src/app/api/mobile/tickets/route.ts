import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildQrPayload, resolveRawTicketToken } from "@/lib/tickets/token";
import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";

export async function GET(req: Request) {
  const userId = await verifyMobileSession(req.headers.get("authorization"));
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tickets = await prisma.ticket.findMany({
    where: {
      OR: [{ holderEmail: user.email }, { order: { customerId: userId } }],
      status: { in: ["VALID", "CHECKED_IN", "TRANSFERRED"] },
    },
    include: {
      ticketType: true,
      event: { include: { venue: true } },
      order: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    tickets: tickets.map((t) => {
      const raw = resolveRawTicketToken(t);
      return {
        publicId: t.publicId,
        secureToken: raw,
        qrPayload: raw ? buildQrPayload(raw) : null,
        eventName: t.event.name,
        startsAt: t.event.startsAt,
        venue: t.event.venue?.name ?? t.event.city ?? "",
        ticketTypeName: t.ticketType.name,
        holderName: t.holderName ?? "",
        orderNumber: t.order.orderNumber,
        status: t.status,
      };
    }),
  });
}
