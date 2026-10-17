import { z } from "zod";
import type { GlobalRole, OrgRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  globalRole: GlobalRole;
  isActive: boolean;
  memberships: {
    organizationId: string;
    role: OrgRole;
    canRefund: boolean;
    isActive: boolean;
  }[];
};

/**
 * Credentials login — read-only against User.
 * Do not write lastActiveAt (or any activity telemetry) here: concurrent
 * auth requests contended on the same User row and caused statement timeouts.
 */
export async function authorizeCredentials(
  credentials: unknown
): Promise<AuthorizedUser | null> {
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) return null;

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
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

  // Reject missing, inactive, or passwordless accounts
  if (!user?.passwordHash || !user.isActive) return null;

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name ?? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
    image: user.image,
    globalRole: user.globalRole,
    isActive: user.isActive,
    memberships: user.memberships,
  };
}
