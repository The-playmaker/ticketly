import { NextResponse } from "next/server";
import { DiscountType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { PromoService } from "@/services/promo-service";
import { resolveOrgIdParam } from "@/lib/admin/org-access";
import { jsonError } from "@/lib/api-error";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: session.user.isActive !== false,
      memberships: session.user.memberships,
    };
    const url = new URL(req.url);
    const orgId = await resolveOrgIdParam(user, url.searchParams.get("organizationId"), {
      requireOrg: true,
    });
    const eventId = url.searchParams.get("eventId") ?? undefined;
    const promos = await PromoService.list(orgId!, eventId ?? undefined);
    return NextResponse.json({ promos });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = {
    id: session.user.id,
    email: session.user.email!,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  const body = await req.json();
  const orgId = await resolveOrgIdParam(user, body.organizationId ?? null, { requireOrg: true });
  if (!canManageEvents(user, orgId!) && !isSuperAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const promo = await PromoService.create(
    {
      organizationId: orgId!,
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
  } catch (e) {
    return jsonError(e);
  }
}
