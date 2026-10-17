import type { GlobalRole, OrgRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AuthJwtFields = {
  id?: string;
  globalRole?: GlobalRole;
  isActive?: boolean;
  disabled?: boolean;
  memberships?: {
    organizationId: string;
    role: OrgRole;
    canRefund: boolean;
    isActive: boolean;
  }[];
};

export type JwtUserSeed = {
  id: string;
  globalRole: GlobalRole;
  isActive: boolean;
  memberships?: AuthJwtFields["memberships"];
};

/**
 * JWT refresh — User reads only (isActive + fresh RBAC/memberships).
 * Never write lastActiveAt on this path: parallel requests with a shared JWT
 * stamped the same User row and triggered Postgres 57014 / Prisma P2024.
 */
export async function refreshAuthJwt(
  token: AuthJwtFields,
  user?: JwtUserSeed | null
): Promise<AuthJwtFields> {
  if (user) {
    token.id = user.id;
    token.globalRole = user.globalRole;
    token.isActive = user.isActive;
    token.memberships = user.memberships ?? [];
    token.disabled = false;
  }

  if (!token.id) return token;

  const fresh = await prisma.user.findUnique({
    where: { id: token.id },
    include: {
      memberships: {
        where: { isActive: true },
        select: {
          organizationId: true,
          role: true,
          canRefund: true,
          isActive: true,
        },
      },
    },
  });

  if (!fresh || !fresh.isActive) {
    return {
      ...token,
      id: undefined,
      disabled: true,
      isActive: false,
      memberships: [],
    };
  }

  token.globalRole = fresh.globalRole;
  token.isActive = true;
  token.disabled = false;
  token.memberships = fresh.memberships;
  return token;
}
