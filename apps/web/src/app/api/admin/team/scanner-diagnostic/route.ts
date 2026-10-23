import { NextResponse } from "next/server";
import {
  requireAdminSession,
  resolveOrgIdParam,
} from "@/lib/admin/org-access";
import { UserAdminService } from "@/services/user-admin-service";
import { AppError, jsonError } from "@/lib/api-error";
import { canManageTeam, isSuperAdmin } from "@/lib/auth/rbac";

/**
 * GET /api/admin/team/scanner-diagnostic?email=…&organizationId=…
 * SUPER_ADMIN or org admin — diagnose DOOR_STAFF scanner access.
 */
export async function GET(req: Request) {
  try {
    const session = await requireAdminSession();
    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: session.user.isActive !== false,
      memberships: session.user.memberships,
    };

    const url = new URL(req.url);
    const email = url.searchParams.get("email") ?? undefined;
    const userId = url.searchParams.get("userId") ?? undefined;
    const orgParam = url.searchParams.get("organizationId");

    const orgId = await resolveOrgIdParam(user, orgParam, {
      requireOrg: !isSuperAdmin(user),
    });

    if (orgId) {
      if (!canManageTeam(user, orgId) && !isSuperAdmin(user)) {
        throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
      }
    } else if (!isSuperAdmin(user)) {
      throw new AppError("ORG_CONTEXT_REQUIRED", "Velg en organisasjon", 400);
    }

    const result = await UserAdminService.diagnoseScannerAccess({
      email,
      userId,
      organizationId: orgId ?? undefined,
    });

    // Org admins may only diagnose users that belong to their org
    if (!isSuperAdmin(user) && orgId) {
      const inOrg = result.memberships.some((m) => m.organizationId === orgId);
      if (!inOrg) {
        throw new AppError("FORBIDDEN", "Brukeren er ikke i denne organisasjonen", 403);
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
