import { NextResponse } from "next/server";
import { checkInSchema, manualCheckInSchema } from "@/lib/validators";
import { CheckInService } from "@/services/check-in-service";
import { getOptionalSession } from "@/lib/auth/session";
import {
  canForceCheckInOverride,
  canScanTickets,
  AuthorizationError,
  type AuthUser,
} from "@/lib/auth/rbac";
import { canAccessAssignedEvent } from "@/lib/auth/event-access";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";
import { jsonError } from "@/lib/api-error";
import { looksLikeDynamicQrCredential } from "@/lib/tickets/dynamic-qr";
import type { CheckInEventAccess } from "@/services/check-in-service";

function eventAccessFor(
  user: AuthUser & { eventAssignments?: { eventId: string }[] }
): CheckInEventAccess {
  return {
    canAccessEvent: (event) =>
      canScanTickets(user, event.organizationId) &&
      canAccessAssignedEvent(user, event),
  };
}

async function resolveUser(
  req: Request
): Promise<AuthUser & { eventAssignments?: { eventId: string }[] }> {
  const mobileId = await verifyMobileSession(req.headers.get("authorization"));
  if (mobileId) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: mobileId },
      include: {
        memberships: { where: { isActive: true } },
        eventAssignments: { select: { eventId: true } },
      },
    });
    if (!user.isActive) throw new AuthorizationError("Unauthorized");
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      globalRole: user.globalRole,
      isActive: user.isActive,
      memberships: user.memberships,
      eventAssignments: user.eventAssignments,
    };
  }
  const session = await getOptionalSession();
  if (!session) throw new AuthorizationError("Unauthorized");
  // Always reload memberships + assignments from DB so scanner access
  // reflects EventAssignment / role changes without waiting on a stale JWT.
  const fresh = await prisma.user.findUnique({
    where: { id: session.id },
    include: {
      memberships: { where: { isActive: true } },
      eventAssignments: { select: { eventId: true } },
    },
  });
  if (!fresh?.isActive) throw new AuthorizationError("Unauthorized");
  return {
    id: fresh.id,
    email: fresh.email,
    name: fresh.name,
    globalRole: fresh.globalRole,
    isActive: fresh.isActive,
    memberships: fresh.memberships,
    eventAssignments: fresh.eventAssignments,
  };
}

/**
 * Keep-warm ping used by the web scanner while it is open: wakes this exact
 * serverless function and its DB connection so the next real scan is fast.
 * Returns no data.
 */
export async function GET(req: Request) {
  const rl = rateLimit(`qr-warm:${clientIp(req)}`, 30);
  if (rl.success) {
    await prisma.$queryRaw`SELECT 1`.catch(() => undefined);
  }
  return new NextResponse(null, { status: 204 });
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
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: parsed.data.eventId },
        select: { id: true, organizationId: true },
      });
      if (
        !canScanTickets(user, event.organizationId) ||
        !canAccessAssignedEvent(user, event)
      ) {
        throw new AuthorizationError();
      }

      if (parsed.data.forceOverride) {
        if (!canForceCheckInOverride(user, event.organizationId)) {
          throw new AuthorizationError("Override krever høyere tilgang");
        }
        if (!parsed.data.note?.trim()) {
          return NextResponse.json(
            { error: { code: "REASON_REQUIRED", message: "Begrunnelse kreves for override" } },
            { status: 400 }
          );
        }
      }

      const result = await CheckInService.checkInByTicketId({
        ...parsed.data,
        checkedInBy: user.id,
        eventAccess: eventAccessFor(user),
      });
      return NextResponse.json(result);
    }

    const parsed = checkInSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
    }

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: parsed.data.eventId },
      select: { id: true, organizationId: true },
    });
    if (
      !canScanTickets(user, event.organizationId) ||
      !canAccessAssignedEvent(user, event)
    ) {
      throw new AuthorizationError();
    }

    // Accept full URL or raw token from QR — never log the raw credential
    const raw = parsed.data.token;
    let token = raw;
    if (looksLikeDynamicQrCredential(raw)) {
      token = raw;
    } else {
      const match = raw.match(/\/t\/verify\/([^/?#]+)/);
      token = match?.[1] ?? raw;
    }

    const result = await CheckInService.checkInByToken({
      token,
      eventId: parsed.data.eventId,
      deviceId: parsed.data.deviceId,
      checkedInBy: user.id,
      eventAccess: eventAccessFor(user),
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      const status = e.message === "Unauthorized" ? 401 : 403;
      return NextResponse.json(
        { error: { code: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", message: e.message } },
        { status }
      );
    }
    return jsonError(e);
  }
}
