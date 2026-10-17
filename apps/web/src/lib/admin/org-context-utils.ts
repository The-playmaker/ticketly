import { ADMIN_ORG_GLOBAL } from "@/lib/admin/org-context-constants";
import type { AdminOrgOption } from "@/lib/admin/org-context-types";

export function parseAdminOrgCookie(
  raw: string | null | undefined,
  organizations: AdminOrgOption[]
): { mode: "global" | "organization"; organizationId: string | null } {
  if (!raw || raw === ADMIN_ORG_GLOBAL) {
    return { mode: "global", organizationId: null };
  }
  const match = organizations.find((o) => o.id === raw);
  if (!match) {
    return { mode: "global", organizationId: null };
  }
  return { mode: "organization", organizationId: match.id };
}

/** Prisma `where` fragment: empty object = no org filter (platform scope). */
export function organizationIdWhere(
  organizationId: string | null | undefined
): { organizationId: string } | Record<string, never> {
  return organizationId ? { organizationId } : {};
}
