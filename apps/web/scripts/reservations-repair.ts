/**
 * Repair stale TicketReservation inventory counters.
 *
 * Default: dry-run (no writes).
 *
 * Usage:
 *   npm run reservations:repair -- --event <eventId>
 *   npm run reservations:repair -- --event <eventId> --apply
 */

import { ReservationService } from "@/services/reservation-service";

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
  const eventId = argValue(args, "--event");
  const apply = hasFlag(args, "--apply");

  if (!eventId) {
    console.error("Usage: npm run reservations:repair -- --event <eventId> [--apply]");
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      eventId,
    })
  );

  const result = await ReservationService.repairEvent({ eventId, apply });

  const summary = {
    dryRun: result.dryRun,
    applied: result.applied,
    eventId: result.eventId,
    now: result.now,
    graceMinutes: result.graceMinutes,
    expiredCount: result.expiredCount,
    types: result.types.map((t) => ({
      ticketTypeId: t.ticketTypeId,
      name: t.name,
      currentQuantityReserved: t.currentQuantityReserved,
      activeTotal: t.activeTotal,
      activeUnexpiredTotal: t.activeUnexpiredTotal,
      expiredActiveReservations: t.expiredActiveCount,
      expiredActiveQuantity: t.expiredActiveQuantity,
      proposedQuantityReserved: t.proposedQuantityReserved,
      delta: t.delta,
      availableBefore: t.availableBefore,
      availableAfter: t.availableAfter,
      quantitySold: t.quantitySold,
      quantityReleased: t.quantityReleased,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "reservations_repair_failed");
  process.exitCode = 1;
});
