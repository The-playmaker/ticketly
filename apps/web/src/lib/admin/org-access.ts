import { auth } from "@/lib/auth";
import {
  canManageEvents,
  canManageOrganization,
  canScanTickets,
  isSuperAdmin,
} from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";

export async function requireAdminSession() {
  const session = await auth();
  if (!session?.user?.id || session.user.isActive === false) {
    throw new AppError("UNAUTHORIZED", "Innlogging kreves", 401);
  }
  return session;
}

export async function resolveOrgIdForUser(userId: string, globalRole: string) {
  if (globalRole === "SUPER_ADMIN") {
    const org = await prisma.organization.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    return org?.id ?? null;
  }
  return (
    await prisma.organizationMember.findFirst({ where: { userId, isActive: true } })
  )?.organizationId ?? null;
}

export async function requireEventAccess(eventId: string) {
  const session = await requireAdminSession();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError("NOT_FOUND", "Ikke funnet", 404);
  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  if (!canManageEvents(user, event.organizationId) && !isSuperAdmin(user)) {
    // Door staff may access attendees/scan paths separately
    if (!canScanTickets(user, event.organizationId)) {
      throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
    }
  }
  return { session, user, event };
}

export async function requireOrgAdmin(organizationId: string) {
  const session = await requireAdminSession();
  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  if (!canManageOrganization(user, organizationId) && !isSuperAdmin(user)) {
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
  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  if (!isSuperAdmin(user)) {
    throw new AppError("FORBIDDEN", "Kun SUPER_ADMIN", 403);
  }
  return { session, user };
}
