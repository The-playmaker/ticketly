import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  nexiConfigHealth,
  stripeConfigHealth,
  resolvePaymentProviderType,
  getPaymentProvider,
  isMockPaymentMode,
} from "@/lib/payments";
import { prisma } from "@/lib/db";
import { PaymentProviderType, WebhookProcessStatus } from "@prisma/client";

/**
 * Safe payment health — config status only, no expensive payment API calls.
 * Reports Nexi and Stripe separately. Active provider is explicit — never auto-failover.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeProvider = resolvePaymentProviderType();
  const nexi = nexiConfigHealth();
  const stripe = stripeConfigHealth();

  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [nexiFailed, stripeFailed] = await Promise.all([
    prisma.webhookEvent.count({
      where: {
        provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
        status: WebhookProcessStatus.FAILED,
        receivedAt: { gte: since },
      },
    }),
    prisma.webhookEvent.count({
      where: {
        provider: PaymentProviderType.STRIPE,
        status: WebhookProcessStatus.FAILED,
        receivedAt: { gte: since },
      },
    }),
  ]);

  function statusFor(
    config: "operational" | "configuration_error",
    failed: number,
    isActive: boolean
  ): "operational" | "configuration_error" | "webhook_error" | "inactive" {
    if (!isActive && config === "configuration_error") return "inactive";
    if (config === "configuration_error") return "configuration_error";
    if (failed > 0) return "webhook_error";
    return "operational";
  }

  const nexiActive =
    activeProvider === PaymentProviderType.NEXI || activeProvider === PaymentProviderType.NETS;
  const stripeActive = activeProvider === PaymentProviderType.STRIPE;

  let stripeRuntimeMessage = stripe.message;
  if (stripeActive) {
    try {
      const health = await getPaymentProvider(PaymentProviderType.STRIPE).getHealth?.();
      if (health?.message) stripeRuntimeMessage = health.message;
    } catch (e) {
      stripeRuntimeMessage = e instanceof Error ? e.message : "Stripe health check failed";
    }
  }

  return NextResponse.json({
    activeProvider,
    mockMode: isMockPaymentMode(),
    note: "Provider is selected before checkout and stored on Payment. No automatic failover.",
    nexiCheckout: {
      status: statusFor(nexi.status, nexiFailed, nexiActive),
      environment: nexi.environment,
      message: nexi.message,
      recentFailedWebhooks24h: nexiFailed,
      activeForNewCheckouts: nexiActive,
    },
    stripe: {
      status: statusFor(stripe.status, stripeFailed, stripeActive),
      mode: stripe.mode,
      message: stripeRuntimeMessage,
      recentFailedWebhooks24h: stripeFailed,
      activeForNewCheckouts: stripeActive,
    },
  });
}
