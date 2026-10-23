import { isDoorStaffOnly } from "@/lib/auth/event-access";
import type { GlobalRole, OrgRole } from "@prisma/client";

/**
 * Resolve where a user should land after credentials login.
 * DOOR_STAFF-only → /scan; everyone else keeps the requested callback (default /admin).
 */
export function resolvePostLoginPath(
  user:
    | {
        globalRole: GlobalRole;
        memberships?: { role: OrgRole; isActive: boolean }[];
      }
    | null
    | undefined,
  callbackUrl = "/admin"
): string {
  if (isDoorStaffOnly(user)) return "/scan";
  return callbackUrl || "/admin";
}
