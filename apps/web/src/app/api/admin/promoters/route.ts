import { NextResponse } from "next/server";
import { DiscountType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { PromoService } from "@/services/promo-service";
import { resolveOrgIdParam } from "@/lib/admin/org-access";
import { jsonError, AppError } from "@/lib/api-error";

/**
 * GET /api/admin/promoters?organizationId=&eventId=&kind=
 * Sales report for promoters / tracking codes (org-scoped).
 */
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
    if (!canManageEvents(user, orgId!) && !isSuperAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const eventId = url.searchParams.get("eventId");
    const kindParam = url.searchParams.get("kind") ?? "TRACKING";
    const kind =
      kindParam === "ALL" || kindParam === "DISCOUNT" || kindParam === "TRACKING"
        ? kindParam
        : "TRACKING";

    const promoters = await PromoService.salesReport({
      organizationId: orgId!,
      eventId: eventId || null,
      kind,
    });

    return NextResponse.json({ promoters });
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * POST /api/admin/promoters — create a promoter tracking code (kind=TRACKING).
 * Attribution only: discount is always forced to 0 (use /api/admin/promos for real discounts).
 */
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
    const orgId = await resolveOrgIdParam(user, body.organizationId ?? null, {
      requireOrg: true,
    });
    if (!canManageEvents(user, orgId!) && !isSuperAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const code = String(body.code ?? "");
    if (!code.trim()) {
      throw new AppError("INVALID_PROMO", "Kode er påkrevd", 400);
    }

    const promo = await PromoService.create(
      {
        organizationId: orgId!,
        code,
        label: body.label != null ? String(body.label) : null,
        kind: "TRACKING",
        discountType: DiscountType.PERCENTAGE,
        // Ignore any client-supplied discount — promoters never discount.
        discountValue: 0,
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
