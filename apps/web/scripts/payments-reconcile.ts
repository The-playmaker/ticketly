/**
 * Stripe ↔ Ticketly payment reconciliation CLI.
 *
 * Default: dry-run (no writes except optional audit on apply).
 *
 * Usage:
 *   npm run payments:reconcile -- --since-hours 24
 *   npm run payments:reconcile -- --apply --since-hours 24
 *   npm run payments:reconcile -- --apply --order TKT-2026-000001
 *   npm run payments:reconcile -- --apply --order-id <cuid> --limit 50
 */

import { PaymentReconciliationService } from "@/services/payment-reconciliation-service";

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = hasFlag(args, "--apply");
  const sinceHours = Number(argValue(args, "--since-hours") ?? "24");
  const limit = Number(argValue(args, "--limit") ?? "200");
  const concurrency = Number(argValue(args, "--concurrency") ?? "5");
  const orderNumber = argValue(args, "--order");
  const orderId = argValue(args, "--order-id");
  const filter = (argValue(args, "--filter") as
    | "all"
    | "discrepancies"
    | undefined) ?? "all";

  if (!Number.isFinite(sinceHours) || sinceHours <= 0) {
    console.error("Invalid --since-hours");
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      sinceHours,
      limit,
      concurrency,
      orderNumber: orderNumber ?? null,
      orderId: orderId ?? null,
    })
  );

  const result = await PaymentReconciliationService.reconcile({
    apply,
    sinceHours,
    limit,
    concurrency,
    orderNumber,
    orderId,
    filter,
  });

  // Safe summary — provider ids/statuses only, no secrets
  const summary = {
    dryRun: result.dryRun,
    scanned: result.scanned,
    applied: result.applied,
    discrepancies: result.discrepancies,
    rows: result.rows.map((r) => ({
      orderNumber: r.orderNumber,
      ticketlyStatus: r.ticketlyStatus,
      stripeSessionStatus: r.stripeSessionStatus,
      stripeSessionPaymentStatus: r.stripeSessionPaymentStatus,
      stripePiStatus: r.stripePiStatus,
      amountMatch: r.amountMatch,
      currencyMatch: r.currencyMatch,
      proposedAction: r.proposedAction,
      anomalyReason: r.anomalyReason,
      applied: r.applied,
      providerSessionId: r.providerSessionId,
      providerPaymentId: r.providerPaymentId,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "reconcile_failed");
  process.exitCode = 1;
});
