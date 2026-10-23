import type { AuthUser } from "@/lib/auth/rbac";
import {
  assertAuthorized,
  canManageEvents,
  canManageOrganization,
  canScanTickets,
  isSuperAdmin,
} from "@/lib/auth/rbac";
import { canAccessAssignedEvent } from "@/lib/auth/event-access";
import { AppError } from "@/lib/api-error";
import { prisma } from "@/lib/db";

type UserWithAssignments = AuthUser & {
  eventAssignments?: { eventId: string }[];
};

/** Never trust client-supplied organizationId — resolve from resource. */
export async function assertCanAccessEventOrg(user: AuthUser, eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError("NOT_FOUND", "Ikke funnet", 404);
  assertAuthorized(
    canManageEvents(user, event.organizationId) || isSuperAdmin(user),
    "Forbidden"
  );
  return event;
}

/** Load event assignments when the session/JWT does not include them. */
export async function withEventAssignments(
  user: AuthUser
): Promise<UserWithAssignments> {
  const eventAssignments = await prisma.eventAssignment.findMany({
    where: { userId: user.id },
    select: { eventId: true },
  });
  return { ...user, eventAssignments };
}

/**
 * Scanner / attendee lookup: org scan role + EventAssignment filter.
 * DOOR_STAFF with no assignments cannot scan any event.
 */
export async function assertCanScanEvent(
  user: UserWithAssignments,
  eventId: string
) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError("NOT_FOUND", "Ikke funnet", 404);
  const withAssign =
    user.eventAssignments !== undefined ? user : await withEventAssignments(user);
  if (
    !canScanTickets(withAssign, event.organizationId) ||
    !canAccessAssignedEvent(withAssign, event)
  ) {
    throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
  }
  return event;
}

export async function assertCanAccessOrder(user: AuthUser, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Ikke funnet", 404);
  const ok =
    isSuperAdmin(user) ||
    canManageOrganization(user, order.organizationId) ||
    canManageEvents(user, order.organizationId) ||
    order.customerId === user.id;
  if (!ok) throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
  return order;
}

export async function assertDeviceNotRevoked(deviceId: string | undefined | null) {
  if (!deviceId) return;
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return; // legacy web scanner device strings allowed
  if (device.revokedAt) {
    throw new AppError("DEVICE_REVOKED", "Denne scanneren er deaktivert", 403);
  }
  await prisma.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });
}
