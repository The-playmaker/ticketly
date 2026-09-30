import { NextResponse } from "next/server";
import { PaymentProviderType, PaymentStatus } from "@prisma/client";
import { PaymentService } from "@/services/payment-service";
import { isStripeMockMode } from "@/lib/payments";
import { prisma } from "@/lib/db";

/**
 * Completes a mock Stripe checkout session (local/demo only).
 * Simulates webhook confirmation — frontend redirect alone never marks paid.
 */
export async function GET(req: Request) {
  if (!isStripeMockMode()) {
    return NextResponse.json({ error: "Mock payments disabled" }, { status: 403 });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const orderId = url.searchParams.get("orderId");
  const redirect = url.searchParams.get("redirect");

  if (!sessionId || !orderId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Simulate webhook with idempotent event id
  const eventId = `mock_evt_${sessionId}`;
  await PaymentService.handleProviderWebhook({
    provider: PaymentProviderType.STRIPE,
    rawBody: JSON.stringify({
      id: eventId,
      type: "checkout.session.completed",
      orderId,
      sessionId,
      paymentId: `mock_pi_${sessionId}`,
      amount: order.total,
      paymentStatus: PaymentStatus.PAID,
    }),
    signature: "mock",
  });

  const target =
    redirect ??
    `${process.env.APP_URL ?? "http://localhost:3456"}/orders/${order.orderNumber}?paid=1`;

  return NextResponse.redirect(target);
}
