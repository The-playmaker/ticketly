import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/security/safe-equal";

/**
 * Require Authorization: Bearer CRON_SECRET (timing-safe).
 * Returns a Response to short-circuit, or null when authorized.
 */
export function requireCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET required" }, { status: 503 });
    }
    return null;
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
