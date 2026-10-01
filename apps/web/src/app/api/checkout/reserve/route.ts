import { NextResponse } from "next/server";
import { ticketSelectionSchema } from "@/lib/validators";
import { ReservationService } from "@/services/reservation-service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`checkout:${ip}`, 30);
  if (!rl.success) {
    return NextResponse.json({ error: "For mange forespørsler" }, { status: 429 });
  }

  try {
    const body = await req.json();
    const parsed = ticketSelectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig forespørsel", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await ReservationService.reserve(parsed.data);
    return NextResponse.json({
      ok: true,
      expiresAt: result.expiresAt,
      reservations: result.reservations.map((r) => ({
        id: r.id,
        ticketTypeId: r.ticketTypeId,
        quantity: r.quantity,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Reservasjon feilet" },
      { status: 409 }
    );
  }
}
