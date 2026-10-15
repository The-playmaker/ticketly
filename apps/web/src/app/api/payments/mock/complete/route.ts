import { NextResponse } from "next/server";
import { PaymentProviderType, PaymentStatus } from "@prisma/client";
import { PaymentService } from "@/services/payment-service";
import { isMockPaymentMode, resolvePaymentProviderType } from "@/lib/payments";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-error";

/**
 * Completes a mock checkout session (local/demo only).
 * Simulates webhook confirmation — frontend redirect alone never marks paid.
 * Forbidden when NODE_ENV=production or mock mode is off.
 */
export async function GET(req: Request) {
  try {
    if (!isMockPaymentMode()) {
      return NextResponse.json(
        { error: { code: "MOCK_PAYMENTS_DISABLED", message: "Mock payments disabled" } },
        { status: 403 }
      );
    }
    PaymentService.assertMockAllowed();

    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    const orderId = url.searchParams.get("orderId");
    const redirect = url.searchParams.get("redirect");

    if (!sessionId || !orderId) {
      return NextResponse.json(
        { error: { code: "MISSING_PARAMS", message: "Missing params" } },
        { status: 400 }
      );
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return NextResponse.json(
        { error: { code: "ORDER_NOT_FOUND", message: "Order not found" } },
        { status: 404 }
      );
    }

    let provider: PaymentProviderType;
    try {
      provider = resolvePaymentProviderType();
    } catch {
      provider = PaymentProviderType.MOCK;
    }
    if (provider !== PaymentProviderType.MOCK && provider !== PaymentProviderType.STRIPE) {
      provider = PaymentProviderType.MOCK;
    }

    const eventId = `mock_evt_${sessionId}`;
    await PaymentService.handleProviderWebhook({
      provider,
      rawBody: JSON.stringify({
        id: eventId,
        type: "checkout.session.completed",
        event: "mock.payment.completed",
        orderId,
        sessionId,
        paymentId: `mock_pi_${sessionId}`,
        amount: order.total,
        currency: order.currency,
        paymentStatus: PaymentStatus.PAID,
      }),
      signature: "mock",
    });

    const target =
      redirect ??
      `${process.env.APP_URL ?? "http://localhost:3456"}/orders/${order.orderNumber}?t=${order.accessToken}&paid=1`;

    return NextResponse.redirect(target);
  } catch (e) {
    return jsonError(e);
  }
}
