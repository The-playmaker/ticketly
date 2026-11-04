import { NextResponse } from "next/server";
import { NotificationService } from "@/services/notification-service";
import { requireCronAuth } from "@/lib/security/cron-auth";

/**
 * Cron-compatible reminder processor.
 * Protect with CRON_SECRET header in production.
 */
export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const result = await NotificationService.processDueReminders(100);
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
