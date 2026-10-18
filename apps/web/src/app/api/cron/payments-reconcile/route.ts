import { NextResponse } from "next/server";
import { PaymentReconciliationService } from "@/services/payment-reconciliation-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel cron: reconcile Stripe payment state into Ticketly.
 * Protect with CRON_SECRET (Authorization: Bearer …).
 * Bounded batch — idempotent; uses markOrderPaid for successful payments.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET required" }, { status: 503 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const sinceHours = Number(url.searchParams.get("sinceHours") ?? "24");
  const limit = Number(url.searchParams.get("limit") ?? "100");

  const result = await PaymentReconciliationService.reconcile({
    apply: !dryRun,
    sinceHours: Number.isFinite(sinceHours) && sinceHours > 0 ? sinceHours : 24,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 100,
    concurrency: 5,
    filter: "all",
  });

  return NextResponse.json({
    dryRun: result.dryRun,
    scanned: result.scanned,
    applied: result.applied,
    discrepancies: result.discrepancies,
    // Compact rows — no secrets / client_secret / card data
    rows: result.rows.map((r) => ({
      orderNumber: r.orderNumber,
      ticketlyStatus: r.ticketlyStatus,
      stripeSessionStatus: r.stripeSessionStatus,
      stripePiStatus: r.stripePiStatus,
      proposedAction: r.proposedAction,
      anomalyReason: r.anomalyReason,
      applied: r.applied,
    })),
  });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
