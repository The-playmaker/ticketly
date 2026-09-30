import { auth } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth/rbac";
import { AuthorizationError } from "@/lib/auth/rbac";

export async function requireSession(): Promise<AuthUser> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthorizationError("Unauthorized");
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };
}

export async function getOptionalSession(): Promise<AuthUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };
}
