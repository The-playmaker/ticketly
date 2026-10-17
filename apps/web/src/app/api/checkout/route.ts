import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderService } from "@/services/order-service";
import { PaymentService } from "@/services/payment-service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { checkoutContactSchema } from "@/lib/validators";
import { jsonError, AppError } from "@/lib/api-error";
import { resolvePaymentProviderType } from "@/lib/payments";
import { prisma } from "@/lib/db";

const bodySchema = checkoutContactSchema
  .extend({
    eventId: z.string().min(1),
    sessionId: z.string().min(8).max(128),
    items: z
      .array(
        z.object({
          ticketTypeId: z.string().min(1),
          quantity: z.number().int().min(1).max(50),
        })
      )
      .min(1)
      .max(20),
    termsAccepted: z.literal(true),
    termsVersion: z.string().max(64).optional(),
    privacyVersion: z.string().max(64).optional(),
    refundPolicyVersion: z.string().max(64).optional(),
    ageConfirmed: z.boolean().optional(),
    marketingOptIn: z.boolean().optional(),
    utmSource: z.string().max(100).optional(),
    utmMedium: z.string().max(100).optional(),
    utmCampaign: z.string().max(100).optional(),
    utmContent: z.string().max(100).optional(),
    utmTerm: z.string().max(100).optional(),
  })
  .strict();

/**
 * POST /api/checkout
 * Creates pending order from reservation + starts provider checkout.
 * Returns only client-safe payment session fields (never secret API keys).
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`checkout-pay:${ip}`, 20);
  if (!rl.success) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "For mange forespørsler" } },
      { status: 429 }
    );
  }

  try {
    const json = await req.json();

    // Reject client-supplied pricing fields (attack surface)
    const forbidden = ["price", "unitPrice", "subtotal", "discount", "tax", "serviceFee", "total"];
    for (const key of forbidden) {
      if (
        key in (json as object) ||
        (Array.isArray(json?.items) &&
          json.items.some((i: Record<string, unknown>) => key in i))
      ) {
        throw new AppError("CLIENT_PRICE_REJECTED", "Prisfelter fra klient godtas ikke", 400);
      }
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Ugyldig data", 400, parsed.error.flatten());
    }

    const eventForAge = await prisma.event.findUnique({
      where: { id: parsed.data.eventId },
      select: { ageLimit: true },
    });
    if (
      eventForAge?.ageLimit != null &&
      eventForAge.ageLimit > 0 &&
      parsed.data.ageConfirmed !== true
    ) {
      throw new AppError("AGE_CONFIRMATION_REQUIRED", "Bekreft alderskravet", 400);
    }

    const order = await OrderService.createPendingOrder({
      eventId: parsed.data.eventId,
      sessionId: parsed.data.sessionId,
      items: parsed.data.items,
      customer: {
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email,
        phone: parsed.data.phone,
      },
      promoCode: parsed.data.promoCode,
      termsAccepted: parsed.data.termsAccepted,
      termsVersion: parsed.data.termsVersion,
      privacyVersion: parsed.data.privacyVersion,
      refundPolicyVersion: parsed.data.refundPolicyVersion,
      marketingOptIn: parsed.data.marketingOptIn,
      ageConfirmed: parsed.data.ageConfirmed,
      attribution: {
        utmSource: parsed.data.utmSource,
        utmMedium: parsed.data.utmMedium,
        utmCampaign: parsed.data.utmCampaign,
        utmContent: parsed.data.utmContent,
        utmTerm: parsed.data.utmTerm,
      },
    });

    // Funnel: checkout started (real analytics — not mocked)
    try {
      await prisma.analyticsEvent.create({
        data: {
          type: "CHECKOUT_STARTED",
          eventId: order.eventId,
          sessionId: parsed.data.sessionId,
          utmSource: parsed.data.utmSource,
          utmMedium: parsed.data.utmMedium,
          utmCampaign: parsed.data.utmCampaign,
        },
      });
    } catch {
      /* non-blocking */
    }

    const provider = resolvePaymentProviderType();
    const checkout = await PaymentService.startCheckout(order.id, provider);

    try {
      await prisma.analyticsEvent.create({
        data: {
          type: "PAYMENT_INITIATED",
          eventId: order.eventId,
          sessionId: parsed.data.sessionId,
          orderId: order.id,
          meta: { provider },
        },
      });
    } catch {
      /* non-blocking */
    }

    // Client-safe payload only
    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      accessToken: order.accessToken,
      total: order.total,
      currency: order.currency,
      provider,
      paymentId: checkout.paymentId ?? checkout.sessionId,
      sessionId: checkout.sessionId,
      integrationType: checkout.integrationType ?? "EmbeddedCheckout",
      checkoutKey: checkout.checkoutKey,
      checkoutScriptUrl: checkout.checkoutScriptUrl,
      checkoutUrl: checkout.checkoutUrl,
    });
  } catch (e) {
    return jsonError(e);
  }
}
