import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PaymentProviderType } from "@prisma/client";
import { z } from "zod";
import { PaymentService } from "@/services/payment-service";
import { jsonError, AppError } from "@/lib/api-error";
import { requireSuperAdmin } from "@/lib/admin/org-access";

export async function GET(req: Request) {
  try {
    await requireSuperAdmin();

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
  } catch (e) {
    return jsonError(e);
  }
}

const replaySchema = z.object({ webhookEventId: z.string().min(1) });

/** Replay OUR idempotent processing only — does not fabricate provider events. */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const body = replaySchema.parse(await req.json());
    const result = await PaymentService.replayWebhookEvent(body.webhookEventId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AppError) return jsonError(e);
    return jsonError(e);
  }
}
