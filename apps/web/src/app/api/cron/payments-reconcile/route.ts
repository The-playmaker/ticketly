import { NextResponse } from "next/server";
import { PaymentReconciliationService } from "@/services/payment-reconciliation-service";
import { NexiPaymentReconciliationService } from "@/services/nexi-payment-reconciliation-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron: reconcile Stripe + Nets Easy payment state into Ticketly.
 * Protect with CRON_SECRET (Authorization: Bearer …).
 * Bounded batch — idempotent; uses markOrderPaid for successful payments.
 *
 * Hobby: do not add Vercel crons schedule — invoke externally / manually.
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
  const provider = (url.searchParams.get("provider") ?? "all").toLowerCase();

  const opts = {
    apply: !dryRun,
    sinceHours: Number.isFinite(sinceHours) && sinceHours > 0 ? sinceHours : 24,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 100,
    concurrency: 5,
  };

  const runStripe = provider === "all" || provider === "stripe";
  const runNexi =
    provider === "all" || provider === "nexi" || provider === "nets";

  const stripe = runStripe
    ? await PaymentReconciliationService.reconcile({ ...opts, filter: "all" })
    : null;
  const nexi = runNexi
    ? await NexiPaymentReconciliationService.reconcile(opts)
    : null;

  return NextResponse.json({
    dryRun: !opts.apply,
    stripe: stripe
      ? {
          scanned: stripe.scanned,
          applied: stripe.applied,
          discrepancies: stripe.discrepancies,
          rows: stripe.rows.map((r) => ({
            orderNumber: r.orderNumber,
            ticketlyStatus: r.ticketlyStatus,
            stripePiStatus: r.stripePiStatus,
            proposedAction: r.proposedAction,
            anomalyReason: r.anomalyReason,
            applied: r.applied,
          })),
        }
      : null,
    nexi: nexi
      ? {
          scanned: nexi.scanned,
          applied: nexi.applied,
          discrepancies: nexi.discrepancies,
          rows: nexi.rows.map((r) => ({
            orderNumber: r.orderNumber,
            ticketlyStatus: r.ticketlyStatus,
            nexiChargedAmount: r.nexiChargedAmount,
            proposedAction: r.proposedAction,
            anomalyReason: r.anomalyReason,
            applied: r.applied,
          })),
        }
      : null,
  });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
