import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { getOptionalSession } from "@/lib/auth/session";
import { transferTicketSchema } from "@/lib/validators";
import { TicketService } from "@/services/ticket-service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { jsonError } from "@/lib/api-error";

function safeEqual(a: string, b: string) {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Transfer ticket to a new holder — rotates credentials so prior QR becomes unusable.
 * Auth: order owner session or order access token. Rate limited.
 * Response never includes raw ticket tokens.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`ticket-transfer:${ip}`, 20);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const body = await req.json();
    const parsed = transferTicketSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
    }

    const accessToken =
      typeof body.accessToken === "string" ? (body.accessToken as string) : undefined;

    const ticket = await prisma.ticket.findUnique({
      where: { id: parsed.data.ticketId },
      include: { order: true, event: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: "Ikke funnet" }, { status: 404 });
    }

    const session = await getOptionalSession();
    const isOwner = Boolean(
      session && ticket.order.customerId && session.id === ticket.order.customerId
    );
    const hasAccess = Boolean(accessToken && safeEqual(accessToken, ticket.order.accessToken));
    if (!isOwner && !hasAccess) {
      return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
    }

    const updated = await TicketService.transferTicket({
      ticketId: ticket.id,
      toName: parsed.data.toName,
      toEmail: parsed.data.toEmail,
      fromUserId: session?.id,
    });

    return NextResponse.json({
      ok: true,
      ticket: {
        publicId: updated.publicId,
        holderName: updated.holderName,
        holderEmail: updated.holderEmail,
        status: updated.status,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
