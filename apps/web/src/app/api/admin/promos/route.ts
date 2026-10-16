import { NextResponse } from "next/server";
import { DiscountType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { PromoService } from "@/services/promo-service";
import { resolveOrgIdForUser } from "@/lib/admin/org-access";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await resolveOrgIdForUser(session.user.id, session.user.globalRole);
  if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });
  const eventId = new URL(req.url).searchParams.get("eventId") ?? undefined;
  const promos = await PromoService.list(orgId, eventId ?? undefined);
  return NextResponse.json({ promos });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await resolveOrgIdForUser(session.user.id, session.user.globalRole);
  if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };
  if (!canManageEvents(user, orgId) && !isSuperAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const promo = await PromoService.create(
    {
      organizationId: orgId,
      code: String(body.code ?? ""),
      discountType: body.discountType === "FIXED" ? DiscountType.FIXED : DiscountType.PERCENTAGE,
      discountValue: Number(body.discountValue),
      eventId: body.eventId ?? null,
      ticketTypeId: body.ticketTypeId ?? null,
      maxUses: body.maxUses != null ? Number(body.maxUses) : null,
      startAt: body.startAt ? new Date(body.startAt) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      isActive: body.isActive !== false,
    },
    session.user.id
  );
  return NextResponse.json({ promo }, { status: 201 });
}
