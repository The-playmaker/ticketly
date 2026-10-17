import { NextResponse } from "next/server";
import { OrgRole } from "@prisma/client";
import { z } from "zod";
import {
  requireAdminSession,
  resolveOrgIdParam,
  requireOrgAdmin,
} from "@/lib/admin/org-access";
import { UserAdminService } from "@/services/user-admin-service";
import { AppError, jsonError } from "@/lib/api-error";
import { clientIp } from "@/lib/security/rate-limit";
import { canManageTeam, isSuperAdmin } from "@/lib/auth/rbac";

async function resolveManagedOrg(req: Request) {
  const session = await requireAdminSession();
  const url = new URL(req.url);
  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  const orgId = await resolveOrgIdParam(user, url.searchParams.get("organizationId"), {
    requireOrg: true,
  });
  if (!orgId) throw new AppError("ORG_CONTEXT_REQUIRED", "Velg en organisasjon", 400);
  if (!canManageTeam(user, orgId) && !isSuperAdmin(user)) {
    throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
  }
  return { session, orgId, user };
}

export async function GET(req: Request) {
  try {
    const { orgId } = await resolveManagedOrg(req);
    const team = await UserAdminService.listOrgTeam(orgId);
    return NextResponse.json({ organizationId: orgId, ...team });
  } catch (e) {
    return jsonError(e);
  }
}

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(OrgRole),
  restrictedEventIds: z.array(z.string()).optional(),
  organizationId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = inviteSchema.parse(await req.json());
    const session = await requireAdminSession();
    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: session.user.isActive !== false,
      memberships: session.user.memberships,
    };
    const orgId = await resolveOrgIdParam(user, body.organizationId, { requireOrg: true });
    if (!orgId) return NextResponse.json({ error: "No org" }, { status: 400 });
    await requireOrgAdmin(orgId);

    const result = await UserAdminService.inviteToOrganization({
      actorId: session.user.id,
      organizationId: orgId,
      email: body.email,
      role: body.role,
      restrictedEventIds: body.restrictedEventIds,
      ipAddress: clientIp(req),
    });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}

const patchSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().optional(),
  role: z.nativeEnum(OrgRole).optional(),
  isActive: z.boolean().optional(),
  restrictedEventIds: z.array(z.string()).nullable().optional(),
  action: z.enum(["update", "remove"]).default("update"),
});

export async function PATCH(req: Request) {
  try {
    const body = patchSchema.parse(await req.json());
    const session = await requireAdminSession();
    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: session.user.isActive !== false,
      memberships: session.user.memberships,
    };
    const orgId = await resolveOrgIdParam(user, body.organizationId, { requireOrg: true });
    if (!orgId) return NextResponse.json({ error: "No org" }, { status: 400 });
    await requireOrgAdmin(orgId);
    const ip = clientIp(req);

    if (body.action === "remove") {
      return NextResponse.json(
        await UserAdminService.removeFromOrganization({
          actorId: session.user.id,
          organizationId: orgId,
          userId: body.userId,
          ipAddress: ip,
        })
      );
    }

    return NextResponse.json(
      await UserAdminService.updateOrgMembership({
        actorId: session.user.id,
        organizationId: orgId,
        userId: body.userId,
        role: body.role,
        isActive: body.isActive,
        restrictedEventIds: body.restrictedEventIds,
        ipAddress: ip,
      })
    );
  } catch (e) {
    return jsonError(e);
  }
}
