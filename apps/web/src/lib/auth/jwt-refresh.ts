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

type RbacRow = {
  globalRole: GlobalRole;
  isActive: boolean;
  memberships: NonNullable<AuthJwtFields["memberships"]>;
} | null;

/**
 * Every auth() call (layout, page, each API route) re-reads the user. On
 * serverless with a remote DB that is one extra round trip per call, and
 * layout + page run in parallel, so a single admin page view did several.
 * Cache per warm instance for a few seconds and share in-flight reads.
 * Role/deactivation changes still apply within RBAC_TTL_MS; scanner check-in
 * re-reads memberships from the DB itself.
 */
const RBAC_TTL_MS = 15_000;
const rbacCache = new Map<string, { at: number; value: Promise<RbacRow> }>();

function loadRbac(userId: string): Promise<RbacRow> {
  const now = Date.now();
  const hit = rbacCache.get(userId);
  if (hit && now - hit.at < RBAC_TTL_MS) return hit.value;
  const value = prisma.user
    .findUnique({
      where: { id: userId },
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
    })
    .catch((e) => {
      rbacCache.delete(userId);
      throw e;
    }) as Promise<RbacRow>;
  rbacCache.set(userId, { at: now, value });
  if (rbacCache.size > 5000) {
    for (const [k, v] of rbacCache) if (now - v.at >= RBAC_TTL_MS) rbacCache.delete(k);
  }
  return value;
}

/** Test hook: drop cached RBAC reads. */
export function resetAuthJwtCache() {
  rbacCache.clear();
}

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

  // A fresh login always reads through; otherwise reuse a very recent read.
  if (user) rbacCache.delete(token.id);
  const fresh = await loadRbac(token.id);

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
