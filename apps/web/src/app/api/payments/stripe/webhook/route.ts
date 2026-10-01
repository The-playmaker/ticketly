import { NextResponse } from "next/server";
import { PaymentProviderType } from "@prisma/client";
import { PaymentService } from "@/services/payment-service";
import { isStripeMockMode } from "@/lib/payments";
import { jsonError } from "@/lib/api-error";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  try {
    // Unsigned bodies only allowed in explicit local mock mode (never production)
    if (!signature) {
      if (!isStripeMockMode()) {
        return NextResponse.json(
          { error: { code: "WEBHOOK_SIGNATURE_REQUIRED", message: "Missing Stripe signature" } },
          { status: 401 }
        );
      }
      PaymentService.assertMockAllowed();
      const result = await PaymentService.handleProviderWebhook({
        provider: PaymentProviderType.STRIPE,
        rawBody,
        signature: "mock",
      });
      return NextResponse.json(result);
    }

    const result = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.STRIPE,
      rawBody,
      signature,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("Stripe webhook error", e instanceof Error ? e.message : "failed");
    return jsonError(e);
  }
}
