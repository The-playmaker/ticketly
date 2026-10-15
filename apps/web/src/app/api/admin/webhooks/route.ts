import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PaymentProviderType } from "@prisma/client";
import { z } from "zod";
import { PaymentService } from "@/services/payment-service";
import { jsonError, AppError } from "@/lib/api-error";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const providerParam = url.searchParams.get("provider")?.toUpperCase();
  const provider =
    providerParam && providerParam in PaymentProviderType
      ? (providerParam as PaymentProviderType)
      : undefined;

  const events = await prisma.webhookEvent.findMany({
    where: provider ? { provider } : undefined,
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: {
      id: true,
      provider: true,
      eventId: true,
      eventType: true,
      paymentId: true,
      orderId: true,
      status: true,
      error: true,
      receivedAt: true,
      processedAt: true,
    },
  });

  return NextResponse.json({ events });
}

const replaySchema = z.object({ webhookEventId: z.string().min(1) });

/** Replay OUR idempotent processing only — does not fabricate provider events. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.globalRole !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = replaySchema.parse(await req.json());
    const result = await PaymentService.replayWebhookEvent(body.webhookEventId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AppError) return jsonError(e);
    return jsonError(e);
  }
}
