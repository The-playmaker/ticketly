import { NextResponse } from "next/server";
import { WaitlistStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { WaitlistService } from "@/services/waitlist-service";

type Ctx = { params: Promise<{ id: string }> };

async function authorize(eventId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };
  if (!canManageEvents(user, event.organizationId) && !isSuperAdmin(user)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, event };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const authz = await authorize(id);
  if ("error" in authz && authz.error) return authz.error;
  const entries = await WaitlistService.list(id);
  const waiting = entries.filter((e) => e.status === WaitlistStatus.WAITING).length;
  return NextResponse.json({ entries, waiting });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const authz = await authorize(id);
  if ("error" in authz && authz.error) return authz.error;
  const body = await req.json();
  const count = Number(body.count ?? 10);
  const invited = await WaitlistService.inviteNext(id, count, {
    actorId: authz.session!.user.id,
    organizationId: authz.event!.organizationId,
  });
  return NextResponse.json({ invited: invited.length, entries: invited });
}
