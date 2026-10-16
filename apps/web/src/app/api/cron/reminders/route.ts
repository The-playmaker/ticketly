import { NextResponse } from "next/server";
import { NotificationService } from "@/services/notification-service";

/**
 * Cron-compatible reminder processor.
 * Protect with CRON_SECRET header in production.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET required" }, { status: 503 });
  }

  const result = await NotificationService.processDueReminders(100);
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
