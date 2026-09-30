import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderService } from "@/services/order-service";
import { PaymentService } from "@/services/payment-service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { checkoutContactSchema } from "@/lib/validators";

const bodySchema = checkoutContactSchema.extend({
  eventId: z.string(),
  sessionId: z.string().min(8),
  items: z.array(
    z.object({
      ticketTypeId: z.string(),
      quantity: z.number().int().min(1),
    })
  ).min(1),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`checkout-pay:${ip}`, 20);
  if (!rl.success) {
    return NextResponse.json({ error: "For mange forespørsler" }, { status: 429 });
  }

  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig data", details: parsed.error.flatten() }, { status: 400 });
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
    });

    const checkout = await PaymentService.startCheckout(order.id);

    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      checkoutUrl: checkout.checkoutUrl,
      sessionId: checkout.sessionId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout feilet" },
      { status: 400 }
    );
  }
}
