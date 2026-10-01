import { NextResponse } from "next/server";

/** Liveness — process is up. No dependency checks. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "ticketly-web",
    timestamp: new Date().toISOString(),
  });
}
