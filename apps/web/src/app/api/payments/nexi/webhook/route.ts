import { NextResponse } from "next/server";
import { PaymentProviderType } from "@prisma/client";
import { PaymentService } from "@/services/payment-service";
import { jsonError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Nexi Checkout webhook endpoint.
 * Nexi sends the shared secret in the Authorization header (value we set on create payment).
 * Must return HTTP 200 — other 2xx codes are treated as failure by Nexi.
 */
export async function POST(req: Request) {
  const authorization = req.headers.get("authorization");
  const rawBody = await req.text();

  try {
    if (!authorization) {
      return NextResponse.json(
        { error: { code: "WEBHOOK_AUTH_REQUIRED", message: "Missing Authorization" } },
        { status: 401 }
      );
    }

    const result = await PaymentService.handleProviderWebhook({
      provider: PaymentProviderType.NEXI,
      rawBody,
      signature: authorization,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "webhook_failed";
    console.error("[nexi webhook]", message);
    // Return 401 for auth failures so Nexi can surface misconfiguration;
    // return 500 for processing errors so Nexi retries.
    if (message.includes("Invalid Nexi webhook") || message.includes("Authorization")) {
      return NextResponse.json(
        { error: { code: "WEBHOOK_AUTH_INVALID", message: "Unauthorized" } },
        { status: 401 }
      );
    }
    return jsonError(e);
  }
}
