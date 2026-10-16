import { NextResponse } from "next/server";
import { WaitlistService } from "@/services/waitlist-service";
import { AppError } from "@/lib/api-error";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await WaitlistService.join({
      eventId: String(body.eventId ?? ""),
      ticketTypeId: body.ticketTypeId ? String(body.ticketTypeId) : undefined,
      email: String(body.email ?? ""),
      name: body.name ? String(body.name) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      requestedQuantity: body.requestedQuantity ? Number(body.requestedQuantity) : 1,
    });
    return NextResponse.json({
      ok: true,
      created: result.created,
      message: "Du står nå på ventelisten.",
      entryId: result.entry.id,
    });
  } catch (e) {
    if (e instanceof AppError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: "Could not join waitlist" }, { status: 500 });
  }
}
