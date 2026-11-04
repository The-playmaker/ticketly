import { NextResponse } from "next/server";
import { promoValidateSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";
import { applyPromo } from "@/services/order-service";
import { PromoService } from "@/services/promo-service";
import { clientIp, rateLimitAsync } from "@/lib/security/rate-limit";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = await rateLimitAsync(`promo:${ip}`, 30);
  if (!rl.success) {
    return NextResponse.json({ error: "For mange forespørsler" }, { status: 429 });
  }

  const parsed = promoValidateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 });
  }

  const event = await prisma.event.findUnique({ where: { id: parsed.data.eventId } });
  if (!event) {
    return NextResponse.json({ error: "Arrangement ikke funnet" }, { status: 404 });
  }

  const promo = await prisma.promoCode.findFirst({
    where: {
      code: { equals: parsed.data.code, mode: "insensitive" },
      organizationId: event.organizationId,
      isActive: true,
      OR: [{ eventId: null }, { eventId: event.id }],
    },
  });

  if (!promo) {
    return NextResponse.json({ error: "Ugyldig kampanjekode" }, { status: 404 });
  }

  const applicable = PromoService.isApplicable(promo, {
    eventId: event.id,
    ticketTypeIds: [],
  });
  // Skip ticket-type check here (cart may not send types); still enforce dates/usage.
  if (!applicable.ok && applicable.reason !== "wrong_ticket_type") {
    return NextResponse.json({ error: "Kampanjekoden kan ikke brukes" }, { status: 400 });
  }

  const discount = applyPromo(promo, parsed.data.subtotal);
  // TRACKING is attribution-only (applyPromo always returns 0) but still valid for checkout.
  if (discount <= 0 && promo.kind !== "TRACKING") {
    return NextResponse.json({ error: "Kampanjekoden kan ikke brukes" }, { status: 400 });
  }

  return NextResponse.json({
    code: promo.code,
    label: promo.label,
    kind: promo.kind,
    discountType: promo.discountType,
    discount,
  });
}
