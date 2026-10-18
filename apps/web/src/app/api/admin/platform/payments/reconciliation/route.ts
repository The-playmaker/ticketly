import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { jsonError } from "@/lib/api-error";
import {
  PaymentReconciliationService,
  type ReconciliationFilter,
} from "@/services/payment-reconciliation-service";

export const dynamic = "force-dynamic";

const filterSchema = z.enum([
  "all",
  "discrepancies",
  "stripe_paid_ticketly_pending",
  "failed",
  "blocked_review",
  "expired",
  "refund_mismatch",
]);

const bodySchema = z.object({
  apply: z.boolean().optional(),
  orderIds: z.array(z.string().min(1)).max(50).optional(),
  orderId: z.string().min(1).optional(),
  filter: filterSchema.optional(),
  sinceHours: z.number().positive().max(720).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function GET(req: Request) {
  try {
    await requireSuperAdmin();
    const url = new URL(req.url);
    const filter = filterSchema.catch("discrepancies").parse(
      url.searchParams.get("filter") ?? "discrepancies"
    ) as ReconciliationFilter;
    const sinceHours = Number(url.searchParams.get("sinceHours") ?? "168");
    const limit = Number(url.searchParams.get("limit") ?? "100");

    const result = await PaymentReconciliationService.reconcile({
      apply: false,
      filter,
      sinceHours: Number.isFinite(sinceHours) ? sinceHours : 168,
      limit: Number.isFinite(limit) ? limit : 100,
      concurrency: 5,
    });

    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireSuperAdmin();
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    if (body.orderId) {
      const row = await PaymentReconciliationService.reconcileOrder(body.orderId, {
        apply: body.apply ?? true,
        actorId: user.id,
      });
      return NextResponse.json({ dryRun: !(body.apply ?? true), scanned: 1, applied: row.applied ? 1 : 0, discrepancies: row.anomalyReason ? 1 : 0, rows: [row] });
    }

    if (body.orderIds?.length) {
      const rows = [];
      let applied = 0;
      for (const id of body.orderIds) {
        const row = await PaymentReconciliationService.reconcileOrder(id, {
          apply: body.apply ?? true,
          actorId: user.id,
        });
        rows.push(row);
        if (row.applied) applied++;
      }
      return NextResponse.json({
        dryRun: !(body.apply ?? true),
        scanned: rows.length,
        applied,
        discrepancies: rows.filter((r) => r.anomalyReason).length,
        rows,
      });
    }

    const result = await PaymentReconciliationService.reconcile({
      apply: body.apply ?? false,
      filter: body.filter ?? "discrepancies",
      sinceHours: body.sinceHours ?? 168,
      limit: body.limit ?? 100,
      concurrency: 5,
      actorId: user.id,
    });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
