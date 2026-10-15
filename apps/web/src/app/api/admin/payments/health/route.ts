import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { nexiConfigHealth, resolvePaymentProviderType, getPaymentProvider } from "@/lib/payments";
import { prisma } from "@/lib/db";
import { PaymentProviderType, WebhookProcessStatus } from "@prisma/client";

/**
 * Safe payment health — config status only, no expensive Nexi payment API calls.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = resolvePaymentProviderType();
  const nexi = nexiConfigHealth();

  let webhookError = false;
  const recentFailed = await prisma.webhookEvent.count({
    where: {
      provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
      status: WebhookProcessStatus.FAILED,
      receivedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
  });
  if (recentFailed > 0) webhookError = true;

  let status: "operational" | "configuration_error" | "webhook_error" = "operational";
  if (provider === PaymentProviderType.NEXI || provider === PaymentProviderType.NETS) {
    if (nexi.status === "configuration_error") status = "configuration_error";
    else if (webhookError) status = "webhook_error";
  } else {
    try {
      const health = await getPaymentProvider(provider).getHealth?.();
      if (health?.status === "configuration_error") status = "configuration_error";
    } catch {
      status = "configuration_error";
    }
  }

  return NextResponse.json({
    provider,
    nexiCheckout: {
      status:
        provider === PaymentProviderType.NEXI || provider === PaymentProviderType.NETS
          ? status
          : nexi.status,
      environment: nexi.environment,
      message: nexi.message,
      recentFailedWebhooks24h: recentFailed,
    },
  });
}
