/**
 * Dry-run (default) report of PAID orders whose Ticket count ≠
 * sum(OrderItem.quantity × TicketType.admissionCount).
 *
 * NEVER deletes tickets. Optional --mark-fulfilled only sets ticketsFulfilledAt
 * when tickets already exist and the marker is null (safe claim).
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env scripts/report-ticket-fulfillment-mismatches.ts
 *   npx tsx --env-file-if-exists=.env scripts/report-ticket-fulfillment-mismatches.ts --order TKT-2026-000010
 *   npx tsx --env-file-if-exists=.env scripts/report-ticket-fulfillment-mismatches.ts --mark-fulfilled
 *
 * Manual remediation for a race duplicate (e.g. TKT-2026-000010 with 2 QR for qty=1):
 *   1. Run this script dry-run for the order — confirm isBundle / admissionCount / expected.
 *   2. Inspect both Ticket rows (status, checkedInAt). Prefer keeping the earlier publicId.
 *   3. If the extra ticket was never scanned: set status=CANCELLED (do not DELETE), adjust
 *      quantitySold −1 if inventory was double-incremented, document in audit.
 *   4. If both scanned or customer disputes: ops/refund path — do not silent-delete.
 *   5. Ensure ticketsFulfilledAt is set (--mark-fulfilled or admin).
 */

import { PrismaClient, PaymentStatus, TicketStatus } from "@prisma/client";

const prisma = new PrismaClient();

function expectedCount(
  items: Array<{ quantity: number; ticketType: { admissionCount: number } }>
) {
  return items.reduce(
    (s, i) => s + i.quantity * Math.max(1, i.ticketType.admissionCount || 1),
    0
  );
}

async function main() {
  const args = process.argv.slice(2);
  const markFulfilled = args.includes("--mark-fulfilled");
  const orderIdx = args.indexOf("--order");
  const orderNumber = orderIdx >= 0 ? args[orderIdx + 1] : undefined;

  const where = {
    paymentStatus: PaymentStatus.PAID,
    ...(orderNumber ? { orderNumber } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    include: {
      items: { include: { ticketType: true } },
      tickets: {
        select: {
          id: true,
          publicId: true,
          status: true,
          checkedInAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: orderNumber ? 1 : 500,
  });

  if (orderNumber && orders.length === 0) {
    console.error(`Order not found: ${orderNumber}`);
    process.exitCode = 1;
    return;
  }

  const rows = orders.map((o) => {
    const expected = expectedCount(o.items);
    const actual = o.tickets.length;
    return {
      orderNumber: o.orderNumber,
      orderId: o.id,
      paidAt: o.paidAt,
      ticketsFulfilledAt: o.ticketsFulfilledAt,
      expected,
      actual,
      mismatch: expected !== actual,
      items: o.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        isBundle: i.ticketType.isBundle,
        admissionCount: i.ticketType.admissionCount,
      })),
      tickets: o.tickets.map((t) => ({
        publicId: t.publicId,
        status: t.status,
        checkedInAt: t.checkedInAt,
        createdAt: t.createdAt,
      })),
    };
  });

  const mismatches = rows.filter((r) => r.mismatch);
  const missingMarker = rows.filter(
    (r) => r.actual > 0 && r.ticketsFulfilledAt == null
  );

  console.log(
    JSON.stringify(
      {
        mode: markFulfilled ? "mark-fulfilled" : "dry-run",
        scanned: rows.length,
        mismatchCount: mismatches.length,
        missingMarkerCount: missingMarker.length,
        // When --order is set, always print full detail (even if counts match)
        report: orderNumber ? rows : mismatches,
        missingMarkerOrderNumbers: missingMarker.map((r) => r.orderNumber),
      },
      null,
      2
    )
  );

  if (markFulfilled) {
    let updated = 0;
    for (const r of missingMarker) {
      await prisma.order.update({
        where: { id: r.orderId },
        data: {
          ticketsFulfilledAt:
            r.paidAt ?? r.tickets[0]?.createdAt ?? new Date(),
        },
      });
      updated += 1;
    }
    console.error(`Marked ticketsFulfilledAt on ${updated} order(s). No tickets deleted.`);
  } else {
    console.error(
      "Dry-run only. Pass --mark-fulfilled to set ticketsFulfilledAt where tickets exist. Never deletes tickets."
    );
  }

  // Hint for known race duplicate pattern
  for (const r of mismatches) {
    if (r.expected === 1 && r.actual === 2) {
      const bothValid = r.tickets.every((t) => t.status === TicketStatus.VALID);
      console.error(
        `\nHINT ${r.orderNumber}: expected 1 got 2 — likely webhook race (not bundle).` +
          ` isBundle=${r.items[0]?.isBundle} admissionCount=${r.items[0]?.admissionCount}.` +
          ` bothValid=${bothValid}. Prefer CANCELLED on newer unused ticket; never DELETE.`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
