import { NextResponse } from "next/server";
import { promoValidateSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";
import { applyPromo } from "@/services/order-service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`promo:${ip}`, 30);
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

  const discount = applyPromo(promo, parsed.data.subtotal);
  if (discount <= 0) {
    return NextResponse.json({ error: "Kampanjekoden kan ikke brukes" }, { status: 400 });
  }

  return NextResponse.json({
    code: promo.code,
    discountType: promo.discountType,
    discount,
  });
}
