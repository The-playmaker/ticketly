import type { AuthUser } from "@/lib/auth/rbac";
import {
  assertAuthorized,
  canManageEvents,
  canManageOrganization,
  canScanTickets,
  isSuperAdmin,
} from "@/lib/auth/rbac";
import { AppError } from "@/lib/api-error";
import { prisma } from "@/lib/db";

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

export async function assertCanScanEvent(user: AuthUser, eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError("NOT_FOUND", "Ikke funnet", 404);
  if (!canScanTickets(user, event.organizationId)) {
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
