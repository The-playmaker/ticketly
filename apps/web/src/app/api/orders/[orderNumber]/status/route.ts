import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { timingSafeEqual } from "crypto";
import { jsonError, AppError } from "@/lib/api-error";

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

    return NextResponse.json({
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      paidAt: order.paidAt,
      ticketCount: order._count.tickets,
    });
  } catch (e) {
    return jsonError(e);
  }
}
