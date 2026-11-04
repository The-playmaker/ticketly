import { NextResponse } from "next/server";
import { PaymentProviderType, PaymentStatus } from "@prisma/client";
import { PaymentService } from "@/services/payment-service";
import { isMockPaymentMode, resolvePaymentProviderType } from "@/lib/payments";
import { prisma } from "@/lib/db";
import { AppError, jsonError } from "@/lib/api-error";

/**
 * Completes a mock checkout session (local/demo only).
 * Simulates webhook confirmation — frontend redirect alone never marks paid.
 * Forbidden when NODE_ENV=production or mock mode is off.
 *
 * sessionId must match Payment.providerSessionId for the order.
 * redirect must be a relative path starting with `/` (not `//`).
 */
function isSafeRelativeRedirect(redirect: string | null): redirect is string {
  if (!redirect) return false;
  if (!redirect.startsWith("/")) return false;
  if (redirect.startsWith("//")) return false;
  if (redirect.includes("://")) return false;
  return true;
}

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

    const payment = await prisma.payment.findFirst({
      where: { orderId, providerSessionId: sessionId },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) {
      throw new AppError(
        "SESSION_MISMATCH",
        "Betalingsøkten matcher ikke ordren",
        400
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
        paymentId: payment.providerPaymentId ?? `mock_pi_${sessionId}`,
        amount: order.total,
        currency: order.currency,
        paymentStatus: PaymentStatus.PAID,
      }),
      signature: "mock",
    });

    const fallback = `/orders/${order.orderNumber}?t=${order.accessToken}&paid=1`;
    const target = isSafeRelativeRedirect(redirect) ? redirect : fallback;

    return NextResponse.redirect(new URL(target, url.origin));
  } catch (e) {
    return jsonError(e);
  }
}
