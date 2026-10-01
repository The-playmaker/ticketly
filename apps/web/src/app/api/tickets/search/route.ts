import { NextResponse } from "next/server";
import { z } from "zod";
import { CheckInService } from "@/services/check-in-service";
import { requireSession } from "@/lib/auth/session";
import { canScanTickets, AuthorizationError } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

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

    const event = await prisma.event.findUniqueOrThrow({ where: { id: parsed.data.eventId } });
    if (!canScanTickets(user, event.organizationId)) {
      throw new AuthorizationError();
    }

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
    const status = e instanceof AuthorizationError ? 403 : 401;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status });
  }
}
