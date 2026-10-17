import { auth } from "@/lib/auth";
import {
  canManageEvents,
  canManageOrganization,
  canScanTickets,
  isSuperAdmin,
  type AuthUser,
} from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
import {
  type AdminOrgScope,
  listAllOrganizations,
  listMembershipOrganizations,
  parseAdminOrgCookie,
  readAdminOrgCookie,
} from "@/lib/admin/org-context";

export async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id || session.user.isActive === false) {
    throw new AppError("UNAUTHORIZED", "Innlogging kreves", 401);
  }
  return session;
}

function sessionUser(session: Awaited<ReturnType<typeof requireAdminSession>>): AuthUser {
  return {
    id: session.user.id,
    email: session.user.email!,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
}

/**
 * Resolve admin organization scope.
 * SUPER_ADMIN: cookie-selected org, or global (all orgs) — membership not required.
 * Others: active membership org (first if multiple); cookie ignored.
 */
export async function resolveOrgScopeForUser(
  userId: string,
  globalRole: string
): Promise<AdminOrgScope> {
  const isPlatformAdmin = globalRole === "SUPER_ADMIN";

  if (isPlatformAdmin) {
    const organizations = await listAllOrganizations();
    if (organizations.length === 0) {
      return {
        mode: "none",
        organizationId: null,
        isPlatformAdmin: true,
        organizations: [],
      };
    }
    const cookie = await readAdminOrgCookie();
    const parsed = parseAdminOrgCookie(cookie, organizations);
    return {
      mode: parsed.mode,
      organizationId: parsed.organizationId,
      isPlatformAdmin: true,
      organizations,
    };
  }

  const organizations = await listMembershipOrganizations(userId);
  if (organizations.length === 0) {
    return {
      mode: "none",
      organizationId: null,
      isPlatformAdmin: false,
      organizations: [],
    };
  }
  return {
    mode: "organization",
    organizationId: organizations[0]!.id,
    isPlatformAdmin: false,
    organizations,
  };
}

/**
 * Resolve a concrete organization id for org-scoped admin surfaces.
 * SUPER_ADMIN in global mode: returns null (caller should prompt to select or list all).
 * SUPER_ADMIN with selected org / non-admin membership: returns that org id.
 */
export async function resolveOrgIdForUser(userId: string, globalRole: string) {
  const scope = await resolveOrgScopeForUser(userId, globalRole);
  return scope.organizationId;
}

/**
 * Prefer explicit organizationId query/body when SUPER_ADMIN; otherwise scope cookie / membership.
 * Throws if a non-platform user supplies another org, or if no org can be resolved when required.
 */
export async function resolveOrgIdParam(
  user: AuthUser,
  explicitOrgId: string | null | undefined,
  opts?: { requireOrg?: boolean }
): Promise<string | null> {
  if (isSuperAdmin(user)) {
    if (explicitOrgId) {
      const org = await prisma.organization.findUnique({ where: { id: explicitOrgId } });
      if (!org) throw new AppError("NOT_FOUND", "Organisasjon ikke funnet", 404);
      return org.id;
    }
    const id = await resolveOrgIdForUser(user.id, user.globalRole);
    if (opts?.requireOrg && !id) {
      throw new AppError(
        "ORG_CONTEXT_REQUIRED",
        "Velg en organisasjon i organisasjonsvelgeren",
        400
      );
    }
    return id;
  }

  const membershipOrgId = await resolveOrgIdForUser(user.id, user.globalRole);
  if (!membershipOrgId) {
    throw new AppError("FORBIDDEN", "Must belong to organization", 403);
  }
  if (explicitOrgId && explicitOrgId !== membershipOrgId) {
    throw new AppError("FORBIDDEN", "Ingen tilgang til denne organisasjonen", 403);
  }
  return membershipOrgId;
}

export async function requireEventAccess(eventId: string) {
  const session = await requireAdminSession();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError("NOT_FOUND", "Ikke funnet", 404);
  const user = sessionUser(session);
  if (isSuperAdmin(user)) {
    return { session, user, event };
  }
  if (!canManageEvents(user, event.organizationId)) {
    if (!canScanTickets(user, event.organizationId)) {
      throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
    }
  }
  return { session, user, event };
}

/**
 * Event create/edit/cover upload — organizer admins / event managers / SUPER_ADMIN.
 * Door staff can scan (requireEventAccess) but cannot mutate event metadata or images.
 */
export async function requireEventManageAccess(eventId: string) {
  const { session, user, event } = await requireEventAccess(eventId);
  if (isSuperAdmin(user)) {
    return { session, user, event };
  }
  if (!canManageEvents(user, event.organizationId)) {
    throw new AppError("FORBIDDEN", "Ingen tilgang til å redigere arrangementet", 403);
  }
  return { session, user, event };
}

export async function requireOrgAdmin(organizationId: string) {
  const session = await requireAdminSession();
  const user = sessionUser(session);
  if (isSuperAdmin(user)) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new AppError("NOT_FOUND", "Organisasjon ikke funnet", 404);
    return { session, user, organization: org };
  }
  if (!canManageOrganization(user, organizationId)) {
    throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
  }
  return { session, user };
}

export async function requireOrgScopedEvent(eventId: string, organizationId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, organizationId },
  });
  if (!event) throw new AppError("FORBIDDEN", "Ingen tilgang til dette arrangementet", 403);
  return event;
}

export async function requireSuperAdmin() {
  const session = await requireAdminSession();
  const user = sessionUser(session);
  if (!isSuperAdmin(user)) {
    throw new AppError("FORBIDDEN", "Kun SUPER_ADMIN", 403);
  }
  return { session, user };
}

/** Alias used by layout / dashboard — same as resolveOrgIdForUser. */
export async function getAdminOrgId(userId: string, globalRole: string) {
  return resolveOrgIdForUser(userId, globalRole);
}
