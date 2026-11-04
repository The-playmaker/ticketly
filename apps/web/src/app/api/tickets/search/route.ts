import { NextResponse } from "next/server";
import { z } from "zod";
import { CheckInService } from "@/services/check-in-service";
import { requireSession } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/rbac";
import { assertCanScanEvent } from "@/lib/auth/org-access";
import { AppError, jsonError } from "@/lib/api-error";

const schema = z.object({
  eventId: z.string(),
  query: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig søk" }, { status: 400 });
    }

    await assertCanScanEvent(user, parsed.data.eventId);

    const results = await CheckInService.searchGuests(parsed.data.eventId, parsed.data.query);
    return NextResponse.json({
      results: results.map((t) => ({
        id: t.id,
        publicId: t.publicId,
        holderName: t.holderName,
        holderEmail: t.holderEmail,
        status: t.status,
        ticketType: t.ticketType.name,
        orderNumber: t.order.orderNumber,
        phone: t.order.customerPhone,
        checkedInAt: t.checkedInAt,
      })),
    });
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return jsonError(new AppError("FORBIDDEN", "Ingen tilgang", 403));
    }
    return jsonError(e);
  }
}
