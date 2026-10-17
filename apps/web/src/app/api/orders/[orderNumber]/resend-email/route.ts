import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { AppError, jsonError } from "@/lib/api-error";
import { sendOrderConfirmationEmail, sendTicketDeliveryEmail } from "@/lib/email/templates";
import { timingSafeEqual } from "crypto";

type Ctx = { params: Promise<{ orderNumber: string }> };

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
 * POST /api/orders/[orderNumber]/resend-email
 * Body: { accessToken: string }
 * Rate-limited resend of confirmation + ticket delivery. Never fails the order.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { orderNumber } = await ctx.params;
  const ip = clientIp(req);
  const rl = rateLimit(`resend-email:${ip}:${orderNumber}`, 5);
  if (!rl.success) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "For mange forespørsler. Prøv igjen senere." } },
      { status: 429 }
    );
  }

  try {
    const body = (await req.json()) as { accessToken?: string };
    if (!body.accessToken) {
      throw new AppError("UNAUTHORIZED", "Mangler tilgang", 401);
    }

    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: {
        tickets: true,
        event: { include: { organization: true, venue: true } },
      },
    });
    if (!order || !safeEqual(body.accessToken, order.accessToken)) {
      throw new AppError("NOT_FOUND", "Ordre ikke funnet", 404);
    }
    if (order.paymentStatus !== "PAID") {
      throw new AppError("ORDER_UNPAID", "Ordren er ikke betalt", 409);
    }

    const appUrl = process.env.APP_URL ?? "http://localhost:3456";
    const ticketsUrl = `${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}`;
    const org = order.event.organization;

    const confirm = await sendOrderConfirmationEmail({
      to: order.customerEmail,
      customerName: `${order.customerFirstName} ${order.customerLastName}`,
      orderNumber: order.orderNumber,
      eventName: order.event.name,
      venue: order.event.venue?.name ?? order.event.city ?? undefined,
      quantity: order.tickets.length,
      total: order.total,
      currency: order.currency,
      sellerName: org.legalName ?? org.name,
      ticketsUrl,
      supportEmail: org.customerServiceEmail ?? org.contactEmail,
      supportPhone: org.customerServicePhone,
      orderId: order.id,
      eventId: order.eventId,
    });

    const tickets = await sendTicketDeliveryEmail({
      to: order.customerEmail,
      customerName: `${order.customerFirstName} ${order.customerLastName}`,
      eventName: order.event.name,
      venue: order.event.venue?.name ?? order.event.city ?? undefined,
      ageLimit: order.event.ageLimit,
      ticketsUrl,
      supportEmail: org.customerServiceEmail ?? org.contactEmail,
      supportPhone: org.customerServicePhone,
      orderId: order.id,
      eventId: order.eventId,
    });

    return NextResponse.json({
      ok: Boolean(confirm?.ok !== false && tickets?.ok !== false),
      email: order.customerEmail,
    });
  } catch (e) {
    return jsonError(e);
  }
}
