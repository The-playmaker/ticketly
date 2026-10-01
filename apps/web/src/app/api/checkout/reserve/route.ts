import { NextResponse } from "next/server";
import { ticketSelectionSchema } from "@/lib/validators";
import { ReservationService } from "@/services/reservation-service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { jsonError, AppError } from "@/lib/api-error";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`checkout:${ip}`, 30);
  if (!rl.success) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "For mange forespørsler" } },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const parsed = ticketSelectionSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Ugyldig forespørsel", 400, parsed.error.flatten());
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
    return jsonError(e);
  }
}
