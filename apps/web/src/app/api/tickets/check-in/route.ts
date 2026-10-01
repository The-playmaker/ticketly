import { NextResponse } from "next/server";
import { checkInSchema, manualCheckInSchema } from "@/lib/validators";
import { CheckInService } from "@/services/check-in-service";
import { getOptionalSession } from "@/lib/auth/session";
import { canScanTickets, AuthorizationError, type AuthUser } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { verifyMobileToken } from "@/app/api/mobile/auth/login/route";

async function resolveUser(req: Request): Promise<AuthUser> {
  const mobileId = verifyMobileToken(req.headers.get("authorization"));
  if (mobileId) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: mobileId },
      include: { memberships: { where: { isActive: true } } },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      globalRole: user.globalRole,
      isActive: user.isActive,
      memberships: user.memberships,
    };
  }
  const session = await getOptionalSession();
  if (!session) throw new AuthorizationError("Unauthorized");
  return session;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`qr-validate:${ip}`, 120);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const user = await resolveUser(req);
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

    // Accept full URL or raw token from QR
    const raw = parsed.data.token;
    const match = raw.match(/\/t\/verify\/([^/?#]+)/);
    const token = match?.[1] ?? raw;

    const result = await CheckInService.checkInByToken({
      token,
      eventId: parsed.data.eventId,
      deviceId: parsed.data.deviceId,
      checkedInBy: user.id,
    });

    return NextResponse.json(result);
  } catch (e) {
    const status = e instanceof AuthorizationError ? (e.message === "Unauthorized" ? 401 : 403) : 401;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unauthorized" },
      { status }
    );
  }
}
