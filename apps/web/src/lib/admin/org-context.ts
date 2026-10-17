import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { ADMIN_ORG_COOKIE, ADMIN_ORG_GLOBAL } from "@/lib/admin/org-context-constants";
import type { AdminOrgOption, AdminOrgScope, OrgContextMode } from "@/lib/admin/org-context-types";
import { parseAdminOrgCookie, organizationIdWhere } from "@/lib/admin/org-context-utils";

export { ADMIN_ORG_COOKIE, ADMIN_ORG_GLOBAL };
export type { AdminOrgOption, AdminOrgScope, OrgContextMode };
export { parseAdminOrgCookie, organizationIdWhere };

export async function readAdminOrgCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ADMIN_ORG_COOKIE)?.value ?? null;
}

export async function listAllOrganizations(): Promise<AdminOrgOption[]> {
  return prisma.organization.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, isActive: true },
  });
}

export async function listMembershipOrganizations(userId: string): Promise<AdminOrgOption[]> {
  const members = await prisma.organizationMember.findMany({
    where: { userId, isActive: true },
    include: {
      organization: { select: { id: true, name: true, slug: true, isActive: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => m.organization);
}
