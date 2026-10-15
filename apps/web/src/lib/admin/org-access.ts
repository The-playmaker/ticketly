import { auth } from "@/lib/auth";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";

export async function requireAdminSession() {
  const session = await auth();
  if (!session?.user) throw new AppError("UNAUTHORIZED", "Innlogging kreves", 401);
  return session;
}

export async function resolveOrgIdForUser(userId: string, globalRole: string) {
  if (globalRole === "SUPER_ADMIN") {
    return (await prisma.organization.findFirst({ where: { slug: "titan-events" } }))?.id;
  }
  return (
    await prisma.organizationMember.findFirst({ where: { userId, isActive: true } })
  )?.organizationId;
}

export async function requireEventAccess(eventId: string) {
  const session = await requireAdminSession();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError("NOT_FOUND", "Ikke funnet", 404);
  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };
  if (!canManageEvents(user, event.organizationId) && !isSuperAdmin(user)) {
    throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
  }
  return { session, user, event };
}

export async function requireOrgScopedEvent(eventId: string, organizationId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, organizationId },
  });
  if (!event) throw new AppError("FORBIDDEN", "Ingen tilgang til dette arrangementet", 403);
  return event;
}
