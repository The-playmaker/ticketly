import { z } from "zod";
import type { GlobalRole, OrgRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimitAsync } from "@/lib/security/rate-limit";

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

const EMAIL_LIMIT = 10;
const IP_LIMIT = 30;
const WINDOW_MS = 15 * 60_000;

export type AuthorizeCredentialsOptions = {
  /** Client IP for rate limiting (from authorize request). */
  ip?: string | null;
};

/**
 * Credentials login — read-only against User.
 * Do not write lastActiveAt (or any activity telemetry) here: concurrent
 * auth requests contended on the same User row and caused statement timeouts.
 *
 * Rate limits (return null when exceeded — no User lock):
 * - 10 attempts / 15 min per email
 * - 30 attempts / 15 min per IP
 */
export async function authorizeCredentials(
  credentials: unknown,
  opts?: AuthorizeCredentialsOptions
): Promise<AuthorizedUser | null> {
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) return null;

  const email = parsed.data.email.toLowerCase();
  const ip = (opts?.ip ?? "unknown").trim() || "unknown";

  const emailRl = await rateLimitAsync(`login:email:${email}`, EMAIL_LIMIT, WINDOW_MS);
  if (!emailRl.success) return null;

  const ipRl = await rateLimitAsync(`login:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!ipRl.success) return null;

  const user = await prisma.user.findUnique({
    where: { email },
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
