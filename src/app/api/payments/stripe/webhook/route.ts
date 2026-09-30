import { NextResponse } from "next/server";
import { PaymentProviderType } from "@prisma/client";
import { PaymentService } from "@/services/payment-service";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  try {
    // In mock mode, allow unsigned test webhooks
    if (process.env.STRIPE_MOCK_MODE === "true" && !signature) {
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
    console.error("Stripe webhook error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Webhook failed" },
      { status: 400 }
    );
  }
}
