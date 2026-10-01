import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Readiness — can serve traffic (DB reachable). No secrets/details. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ready",
      checks: { database: "ok" },
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
