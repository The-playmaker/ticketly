import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/org-access";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { jsonError, AppError } from "@/lib/api-error";
import {
  ADMIN_ORG_COOKIE,
  ADMIN_ORG_GLOBAL,
  listMembershipOrganizations,
  parseAdminOrgCookie,
  readAdminOrgCookie,
} from "@/lib/admin/org-context";

const bodySchema = z.object({
  /** Organization id, or `__all__` for platform-wide view. */
  organizationId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const session = await requireAdminSession();
    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: session.user.isActive !== false,
      memberships: session.user.memberships,
    };
    const body = bodySchema.parse(await req.json());
    const value = body.organizationId;

    if (isSuperAdmin(user)) {
      if (value !== ADMIN_ORG_GLOBAL) {
        const org = await prisma.organization.findUnique({ where: { id: value } });
        if (!org) throw new AppError("NOT_FOUND", "Organisasjon ikke funnet", 404);
      }
    } else {
      if (value === ADMIN_ORG_GLOBAL) {
        throw new AppError("FORBIDDEN", "Kun SUPER_ADMIN kan bruke global modus", 403);
      }
      const orgs = await listMembershipOrganizations(user.id);
      if (!orgs.some((o) => o.id === value)) {
        throw new AppError("FORBIDDEN", "Ingen tilgang til denne organisasjonen", 403);
      }
    }

    const res = NextResponse.json({
      ok: true,
      organizationId: value === ADMIN_ORG_GLOBAL ? null : value,
      mode: value === ADMIN_ORG_GLOBAL ? "global" : "organization",
    });
    res.cookies.set(ADMIN_ORG_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Ugyldig data" } },
        { status: 400 }
      );
    }
    return jsonError(e);
  }
}

export async function GET() {
  try {
    const session = await requireAdminSession();
    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: session.user.isActive !== false,
      memberships: session.user.memberships,
    };

    const organizations = isSuperAdmin(user)
      ? await prisma.organization.findMany({
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
          select: { id: true, name: true, slug: true, isActive: true },
        })
      : await listMembershipOrganizations(user.id);

    const raw = await readAdminOrgCookie();
    const parsed = isSuperAdmin(user)
      ? parseAdminOrgCookie(raw, organizations)
      : {
          mode: "organization" as const,
          organizationId: organizations[0]?.id ?? null,
        };

    return NextResponse.json({
      isPlatformAdmin: isSuperAdmin(user),
      organizations,
      ...parsed,
    });
  } catch (e) {
    return jsonError(e);
  }
}
