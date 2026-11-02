import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth/rbac";
import { AuthorizationError } from "@/lib/auth/rbac";

function toAuthUser(session: {
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    globalRole: AuthUser["globalRole"];
    isActive?: boolean;
    memberships?: AuthUser["memberships"];
  };
}): AuthUser {
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };
}

export async function requireSession(): Promise<AuthUser> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthorizationError("Unauthorized");
  }
  const isActive = Boolean(session.user.isActive);
  if (!isActive) {
    throw new AuthorizationError("Unauthorized");
  }
  return toAuthUser(session);
}

/**
 * SSR admin pages: redirect to login when session is missing.
 * Never access session.user without this (or equivalent) — Next may render
 * page and layout in parallel, so layout redirects alone are not enough.
 */
export async function requireAdminPageSession(
  callbackUrl = "/admin"
): Promise<AuthUser> {
  const session = await auth();
  if (!session?.user?.id || session.user.isActive === false) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  return toAuthUser(session);
}

export async function getOptionalSession(): Promise<AuthUser | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.isActive) return null;
  return toAuthUser(session);
}
