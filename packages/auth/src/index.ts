import type { GlobalRole, OrgRole, OrganizationMember, User } from "@ticketly/database";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  globalRole: GlobalRole;
  isActive: boolean;
  memberships?: Pick<OrganizationMember, "organizationId" | "role" | "canRefund" | "isActive">[];
};

export const ORG_OWNER_ROLE = "ORGANIZER_ADMIN" as OrgRole;

export function isSuperAdmin(user: AuthUser | null | undefined): boolean {
  return user?.globalRole === ("SUPER_ADMIN" as GlobalRole) && !!user.isActive;
}

export function getOrgMembership(user: AuthUser | null | undefined, organizationId: string) {
  if (!user?.isActive) return null;
  return user.memberships?.find((m) => m.organizationId === organizationId && m.isActive) ?? null;
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
  return hasOrgRole(user, organizationId, ["ORGANIZER_ADMIN" as OrgRole]);
}

export function canManageEvents(user: AuthUser | null | undefined, organizationId: string) {
  return hasOrgRole(user, organizationId, [
    "ORGANIZER_ADMIN" as OrgRole,
    "EVENT_MANAGER" as OrgRole,
  ]);
}

export function canScanTickets(user: AuthUser | null | undefined, organizationId: string) {
  return hasOrgRole(user, organizationId, [
    "ORGANIZER_ADMIN" as OrgRole,
    "EVENT_MANAGER" as OrgRole,
    "DOOR_STAFF" as OrgRole,
  ]);
}

export function canViewFinancials(user: AuthUser | null | undefined, organizationId: string) {
  if (isSuperAdmin(user)) return true;
  return hasOrgRole(user, organizationId, [
    "ORGANIZER_ADMIN" as OrgRole,
    "EVENT_MANAGER" as OrgRole,
  ]);
}

export function canManageTeam(user: AuthUser | null | undefined, organizationId: string) {
  return canManageOrganization(user, organizationId);
}

export function canManageDevices(user: AuthUser | null | undefined, organizationId: string) {
  return canManageOrganization(user, organizationId) || isSuperAdmin(user);
}

export function canAccessAdmin(user: AuthUser | null | undefined): boolean {
  if (!user?.isActive) return false;
  if (isSuperAdmin(user)) return true;
  return user.memberships?.some((m) => m.isActive) ?? false;
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

export type { User, OrganizationMember, GlobalRole, OrgRole };
