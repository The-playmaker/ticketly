import {
  GlobalRole,
  OrgRole,
  type OrganizationMember,
  type User,
} from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  globalRole: User["globalRole"];
  isActive: boolean;
  memberships?: Pick<OrganizationMember, "organizationId" | "role" | "canRefund" | "isActive">[];
};

export function isSuperAdmin(user: AuthUser | null | undefined): boolean {
  return user?.globalRole === GlobalRole.SUPER_ADMIN && !!user.isActive;
}

export function getOrgMembership(user: AuthUser | null | undefined, organizationId: string) {
  if (!user?.isActive) return null;
  return (
    user.memberships?.find((m) => m.organizationId === organizationId && m.isActive) ?? null
  );
}

export function hasOrgRole(
  user: AuthUser | null | undefined,
  organizationId: string,
  roles: OrgRole[]
): boolean {
  if (isSuperAdmin(user)) return true;
  const m = getOrgMembership(user, organizationId);
  return !!m && roles.includes(m.role);
}

export function canManageOrganization(user: AuthUser | null | undefined, organizationId: string) {
  return hasOrgRole(user, organizationId, [OrgRole.ORGANIZER_ADMIN]);
}

export function canManageEvents(user: AuthUser | null | undefined, organizationId: string) {
  return hasOrgRole(user, organizationId, [OrgRole.ORGANIZER_ADMIN, OrgRole.EVENT_MANAGER]);
}

export function canScanTickets(user: AuthUser | null | undefined, organizationId: string) {
  return hasOrgRole(user, organizationId, [
    OrgRole.ORGANIZER_ADMIN,
    OrgRole.EVENT_MANAGER,
    OrgRole.DOOR_STAFF,
  ]);
}

export function canRefund(
  user: AuthUser | null | undefined,
  organizationId: string,
  orgAllowsRefunds = true
): boolean {
  if (isSuperAdmin(user)) return true;
  if (!orgAllowsRefunds) return false;
  const m = getOrgMembership(user, organizationId);
  if (!m) return false;
  if (m.role === OrgRole.ORGANIZER_ADMIN) return m.canRefund || true; // admins default can if org allows
  return m.canRefund;
}

export function canAccessAdmin(user: AuthUser | null | undefined): boolean {
  if (!user?.isActive) return false;
  if (isSuperAdmin(user)) return true;
  return (user.memberships?.some((m) => m.isActive) ?? false);
}

export class AuthorizationError extends Error {
  status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function assertAuthorized(condition: boolean, message = "Forbidden"): asserts condition {
  if (!condition) throw new AuthorizationError(message);
}
