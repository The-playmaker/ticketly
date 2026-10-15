import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nexiConfigHealth, resolvePaymentProviderType } from "@/lib/payments";
import { PaymentProviderType, WebhookProcessStatus } from "@prisma/client";

/**
 * Operational checks — no credentials, no expensive payment API calls.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let database: "ok" | "error" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "error";
  }

  let provider: string;
  try {
    provider = resolvePaymentProviderType();
  } catch (e) {
    provider = e instanceof Error ? e.message : "error";
  }

  const nexi = nexiConfigHealth();

  const failedWebhooks24h = await prisma.webhookEvent.count({
    where: {
      provider: { in: [PaymentProviderType.NEXI, PaymentProviderType.NETS] },
      status: WebhookProcessStatus.FAILED,
      receivedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
  });

  const emailProvider = process.env.EMAIL_PROVIDER ?? "console";
  const email =
    emailProvider === "console"
      ? { status: "dev_console" as const, message: "Not production email" }
      : { status: "configured" as const, provider: emailProvider };

  const redis =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
      ? { status: "configured" as const }
      : { status: "in_memory_fallback" as const };

  return NextResponse.json({
    database,
    paymentProvider: provider,
    nexi: {
      status:
        failedWebhooks24h > 0 && nexi.status === "operational"
          ? "webhook_error"
          : nexi.status,
      environment: nexi.environment,
      message: nexi.message,
      failedWebhooks24h,
    },
    email,
    redis,
  });
}
