import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isProductionEmailConfigured } from "@/lib/email/provider";

/** Readiness — can serve traffic (DB reachable). Email status is advisory, not a hard fail. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const emailOk = isProductionEmailConfigured();
    const isProd = process.env.NODE_ENV === "production";
    return NextResponse.json({
      status: "ready",
      checks: {
        database: "ok",
        email: emailOk ? "ok" : isProd ? "console_blocked_for_launch" : "dev_console",
      },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: "not_ready",
        checks: { database: "error" },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
