import { OrgRole, GlobalRole } from "@prisma/client";

/** Friendly Norwegian labels — enum values stay unchanged in API/DB. */
export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  [OrgRole.ORGANIZER_ADMIN]: "Administrator",
  [OrgRole.EVENT_MANAGER]: "Eventansvarlig",
  [OrgRole.DOOR_STAFF]: "Dør / scanner",
};

export const GLOBAL_ROLE_LABELS: Partial<Record<GlobalRole, string>> = {
  [GlobalRole.SUPER_ADMIN]: "Superadmin",
  [GlobalRole.CUSTOMER]: "Kunde",
};

export function orgRoleLabel(role: string): string {
  if (role in ORG_ROLE_LABELS) {
    return ORG_ROLE_LABELS[role as OrgRole];
  }
  return role;
}
