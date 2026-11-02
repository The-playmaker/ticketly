/**
 * Payment reconciliation CLI (Stripe + Nets Easy / Nexi).
 *
 * Default: dry-run (no writes except optional audit on apply).
 *
 * Usage:
 *   npm run payments:reconcile -- --since-hours 24
 *   npm run payments:reconcile -- --apply --since-hours 24
 *   npm run payments:reconcile -- --provider stripe --apply
 *   npm run payments:reconcile -- --provider nexi --apply --order TKT-2026-000001
 *   npm run payments:reconcile -- --apply --order-id <cuid> --limit 50
 */

import { PaymentReconciliationService } from "@/services/payment-reconciliation-service";
import { NexiPaymentReconciliationService } from "@/services/nexi-payment-reconciliation-service";

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
  const providerRaw = (argValue(args, "--provider") ?? "all").toLowerCase();
  const filter = (argValue(args, "--filter") as
    | "all"
    | "discrepancies"
    | undefined) ?? "all";

  if (!Number.isFinite(sinceHours) || sinceHours <= 0) {
    console.error("Invalid --since-hours");
    process.exitCode = 1;
    return;
  }

  const runStripe = providerRaw === "all" || providerRaw === "stripe";
  const runNexi =
    providerRaw === "all" ||
    providerRaw === "nexi" ||
    providerRaw === "nets" ||
    providerRaw === "nets-easy";

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      sinceHours,
      limit,
      concurrency,
      provider: providerRaw,
      orderNumber: orderNumber ?? null,
      orderId: orderId ?? null,
    })
  );

  if (runStripe) {
    const result = await PaymentReconciliationService.reconcile({
      apply,
      sinceHours,
      limit,
      concurrency,
      orderNumber,
      orderId,
      filter,
    });

    console.log(
      JSON.stringify(
        {
          provider: "stripe",
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
        },
        null,
        2
      )
    );
  }

  if (runNexi) {
    const result = await NexiPaymentReconciliationService.reconcile({
      apply,
      sinceHours,
      limit,
      concurrency,
      orderNumber,
      orderId,
    });

    console.log(
      JSON.stringify(
        {
          provider: "nexi",
          dryRun: result.dryRun,
          scanned: result.scanned,
          applied: result.applied,
          discrepancies: result.discrepancies,
          rows: result.rows.map((r) => ({
            orderNumber: r.orderNumber,
            ticketlyStatus: r.ticketlyStatus,
            nexiChargedAmount: r.nexiChargedAmount,
            nexiReservedAmount: r.nexiReservedAmount,
            nexiRefundedAmount: r.nexiRefundedAmount,
            amountMatch: r.amountMatch,
            currencyMatch: r.currencyMatch,
            proposedAction: r.proposedAction,
            anomalyReason: r.anomalyReason,
            applied: r.applied,
            providerPaymentId: r.providerPaymentId,
            providerChargeId: r.providerChargeId,
          })),
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "reconcile_failed");
  process.exitCode = 1;
});
