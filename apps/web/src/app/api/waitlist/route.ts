import { NextResponse } from "next/server";
import { z } from "zod";
import { WaitlistService } from "@/services/waitlist-service";
import { jsonError, AppError } from "@/lib/api-error";
import { clientIp, rateLimitAsync } from "@/lib/security/rate-limit";
import { emailSchema } from "@/lib/validators";

const joinSchema = z.object({
  eventId: z.string().min(1),
  ticketTypeId: z.string().min(1).optional(),
  email: emailSchema,
  name: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  requestedQuantity: z.number().int().min(1).max(20).default(1),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  try {
    const json = await req.json();
    const parsed = joinSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Ugyldig forespørsel", 400, parsed.error.flatten());
    }

    const emailRl = await rateLimitAsync(
      `waitlist:email:${parsed.data.email}`,
      5,
      15 * 60_000
    );
    const ipRl = await rateLimitAsync(`waitlist:ip:${ip}`, 20, 15 * 60_000);
    if (!emailRl.success || !ipRl.success) {
      throw new AppError("RATE_LIMITED", "For mange forespørsler. Prøv igjen senere.", 429);
    }

    const result = await WaitlistService.join({
      eventId: parsed.data.eventId,
      ticketTypeId: parsed.data.ticketTypeId,
      email: parsed.data.email,
      name: parsed.data.name,
      phone: parsed.data.phone,
      requestedQuantity: parsed.data.requestedQuantity,
    });
    return NextResponse.json({
      ok: true,
      created: result.created,
      message: "Du står nå på ventelisten.",
      entryId: result.entry.id,
    });
  } catch (e) {
    return jsonError(e);
  }
}
