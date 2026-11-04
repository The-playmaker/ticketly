import { NextResponse } from "next/server";
import { Prisma, WaitlistStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { WaitlistService } from "@/services/waitlist-service";
import { AppError, jsonError } from "@/lib/api-error";

type Ctx = { params: Promise<{ id: string }> };

async function authorize(eventId: string) {
  const session = await auth();
  if (!session?.user) throw new AppError("UNAUTHORIZED", "Innlogging kreves", 401);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError("NOT_FOUND", "Arrangement ikke funnet", 404);
  const user = {
    id: session.user.id,
    email: session.user.email!,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };
  if (!canManageEvents(user, event.organizationId) && !isSuperAdmin(user)) {
    throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
  }
  return { session, event };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await authorize(id);
    const entries = await WaitlistService.list(id);
    const waiting = entries.filter((e) => e.status === WaitlistStatus.WAITING).length;
    return NextResponse.json({ entries, waiting });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return jsonError(new AppError("NOT_FOUND", "Arrangement ikke funnet", 404));
    }
    return jsonError(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const authz = await authorize(id);
    const body = await req.json();
    const count = Number(body.count ?? 10);
    const invited = await WaitlistService.inviteNext(id, count, {
      actorId: authz.session.user.id,
      organizationId: authz.event.organizationId,
    });
    return NextResponse.json({ invited: invited.length, entries: invited });
  } catch (e) {
    return jsonError(e);
  }
}
