import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { timingSafeEqual } from "crypto";
import { jsonError, AppError } from "@/lib/api-error";
import { PaymentStatus } from "@prisma/client";
import { TicketService } from "@/services/ticket-service";

type Params = { params: Promise<{ orderNumber: string }> };

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

export async function GET(req: Request, { params }: Params) {
  try {
    const { orderNumber } = await params;
    const url = new URL(req.url);
    const t = url.searchParams.get("t");
    if (!t) throw new AppError("UNAUTHORIZED", "Mangler tilgangstoken", 401);

    const order = await prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        orderNumber: true,
        ticketsFulfilledAt: true,
        paymentAnomaly: true,
        accessToken: true,
        paymentStatus: true,
        orderStatus: true,
        paidAt: true,
        _count: { select: { tickets: true } },
      },
    });
    if (!order || !safeEqual(t, order.accessToken)) {
      throw new AppError("NOT_FOUND", "Ordre ikke funnet", 404);
    }

    let ticketCount = order._count.tickets;
    // Self-heal: the buyer's confirmation page polls this. If the order is paid
    // but tickets were never issued (webhook issuance failed), try again here.
    // Locked + idempotent; waits a few seconds so the webhook gets first go.
    if (
      order.paymentStatus === PaymentStatus.PAID &&
      !order.paymentAnomaly &&
      ticketCount === 0 &&
      order.ticketsFulfilledAt == null &&
      order.paidAt &&
      Date.now() - order.paidAt.getTime() > 8_000
    ) {
      try {
        const issued = await TicketService.issueTicketsForPaidOrder(order.id);
        ticketCount = issued.length;
      } catch (e) {
        console.error(
          "Self-heal fulfillment failed",
          order.orderNumber,
          e instanceof Error ? e.message : e
        );
      }
    }

    return NextResponse.json({
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      paidAt: order.paidAt,
      ticketCount,
    });
  } catch (e) {
    return jsonError(e);
  }
}
