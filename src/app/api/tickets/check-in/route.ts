import { NextResponse } from "next/server";
import { checkInSchema, manualCheckInSchema } from "@/lib/validators";
import { CheckInService } from "@/services/check-in-service";
import { requireSession } from "@/lib/auth/session";
import { canScanTickets, AuthorizationError } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`qr-validate:${ip}`, 120);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const user = await requireSession();
    const body = await req.json();

    if (body.ticketId) {
      const parsed = manualCheckInSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
      }
      const event = await prisma.event.findUniqueOrThrow({ where: { id: parsed.data.eventId } });
      if (!canScanTickets(user, event.organizationId)) {
        throw new AuthorizationError();
      }
      const result = await CheckInService.checkInByTicketId({
        ...parsed.data,
        checkedInBy: user.id,
      });
      return NextResponse.json(result);
    }

    const parsed = checkInSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
    }

    const event = await prisma.event.findUniqueOrThrow({ where: { id: parsed.data.eventId } });
    if (!canScanTickets(user, event.organizationId)) {
      throw new AuthorizationError();
    }

    const result = await CheckInService.checkInByToken({
      token: parsed.data.token,
      eventId: parsed.data.eventId,
      deviceId: parsed.data.deviceId,
      checkedInBy: user.id,
    });

    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof AuthorizationError ? e.status : 401;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unauthorized" },
      { status }
    );
  }
}
