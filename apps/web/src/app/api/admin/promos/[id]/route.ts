import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { PromoService } from "@/services/promo-service";
import { resolveOrgIdParam } from "@/lib/admin/org-access";
import { jsonError } from "@/lib/api-error";
import { DiscountType } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
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

    const { id } = await ctx.params;
    const promo = await PromoService.update(
      id,
      orgId!,
      {
        ...(body.code != null ? { code: String(body.code) } : {}),
        ...(body.discountType != null
          ? {
              discountType:
                body.discountType === "FIXED" ? DiscountType.FIXED : DiscountType.PERCENTAGE,
            }
          : {}),
        ...(body.discountValue != null ? { discountValue: Number(body.discountValue) } : {}),
        ...(body.maxUses !== undefined
          ? { maxUses: body.maxUses == null ? null : Number(body.maxUses) }
          : {}),
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        ...(body.startAt !== undefined
          ? { startAt: body.startAt ? new Date(body.startAt) : null }
          : {}),
        ...(body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
          : {}),
      },
      session.user.id
    );
    return NextResponse.json({ promo });
  } catch (e) {
    return jsonError(e);
  }
}
