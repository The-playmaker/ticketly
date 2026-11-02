import { cookies } from "next/headers";
import { ADMIN_ORG_COOKIE, ADMIN_ORG_GLOBAL } from "@/lib/admin/org-context-constants";
import type { AdminOrgOption, AdminOrgScope, OrgContextMode } from "@/lib/admin/org-context-types";
import { parseAdminOrgCookie, organizationIdWhere } from "@/lib/admin/org-context-utils";
import {
  getCachedAllOrganizations,
  getCachedMembershipOrganizations,
} from "@/lib/cache/cached-reads";

export { ADMIN_ORG_COOKIE, ADMIN_ORG_GLOBAL };
export type { AdminOrgOption, AdminOrgScope, OrgContextMode };
export { parseAdminOrgCookie, organizationIdWhere };

export async function readAdminOrgCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ADMIN_ORG_COOKIE)?.value ?? null;
}

/** Short-TTL cached — safe for switcher; RBAC still enforced on mutations. */
export async function listAllOrganizations(): Promise<AdminOrgOption[]> {
  return getCachedAllOrganizations();
}

/** Short-TTL cached membership orgs for the given user. */
export async function listMembershipOrganizations(userId: string): Promise<AdminOrgOption[]> {
  return getCachedMembershipOrganizations(userId);
}
