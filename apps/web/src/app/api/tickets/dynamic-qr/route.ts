import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { getOptionalSession } from "@/lib/auth/session";
import { mintDynamicQrSchema } from "@/lib/validators";
import { DynamicQrService } from "@/services/dynamic-qr-service";
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
 * Mint a short-lived dynamic QR credential for an authorized ticket holder.
 *
 * Auth: logged-in order owner OR order access token.
 * Does NOT accept a static QR token as proof of ownership (prevents copied-QR refresh loops).
 *
 * Disabled unless ENABLE_DYNAMIC_QR=true and event.qrMode=DYNAMIC_QR.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`dqr-mint:${ip}`, 30);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const parsed = mintDynamicQrSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: parsed.data.ticketId },
      include: { order: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: "Ikke funnet" }, { status: 404 });
    }

    const session = await getOptionalSession();
    const isOwner = Boolean(
      session && ticket.order.customerId && session.id === ticket.order.customerId
    );
    const hasAccess = Boolean(
      parsed.data.accessToken && safeEqual(parsed.data.accessToken, ticket.order.accessToken)
    );

    if (!isOwner && !hasAccess) {
      return NextResponse.json({ error: "Ingen tilgang" }, { status: 403 });
    }

    // Per-ticket mint rate limit (access-token / owner abuse)
    const ticketRl = rateLimit(`dqr-mint-ticket:${ticket.id}`, 60);
    if (!ticketRl.success) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }

    const minted = await DynamicQrService.mintForTicket({
      ticketId: ticket.id,
      authorized: true,
    });

    return NextResponse.json(minted, {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
