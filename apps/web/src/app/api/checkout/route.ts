import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderService } from "@/services/order-service";
import { PaymentService } from "@/services/payment-service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { checkoutContactSchema } from "@/lib/validators";
import { jsonError, AppError } from "@/lib/api-error";

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
    termsAccepted: z.boolean().optional(),
    termsVersion: z.string().max(64).optional(),
  })
  .strict();

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
      if (key in (json as object) || (Array.isArray(json?.items) && json.items.some((i: Record<string, unknown>) => key in i))) {
        throw new AppError("CLIENT_PRICE_REJECTED", "Prisfelter fra klient godtas ikke", 400);
      }
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Ugyldig data", 400, parsed.error.flatten());
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
    });

    const checkout = await PaymentService.startCheckout(order.id);

    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      accessToken: order.accessToken,
      total: order.total,
      currency: order.currency,
      checkoutUrl: checkout.checkoutUrl,
      sessionId: checkout.sessionId,
    });
  } catch (e) {
    return jsonError(e);
  }
}
