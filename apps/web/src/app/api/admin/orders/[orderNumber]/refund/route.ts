import { NextResponse } from "next/server";
import { z } from "zod";
import { TicketStatus } from "@prisma/client";
import { requireOrderManageAccess } from "@/lib/admin/org-access";
import { AppError, jsonError } from "@/lib/api-error";
import { canRefund } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { RefundService } from "@/services/refund-service";

type Ctx = { params: Promise<{ orderNumber: string }> };

const bodySchema = z
  .object({
    /** Refund this many tickets (unused ones, newest first). */
    quantity: z.number().int().min(1).max(500).optional(),
    /** Or exactly these tickets. */
    ticketIds: z.array(z.string().min(1)).min(1).max(500).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((b) => b.quantity != null || b.ticketIds != null, {
    message: "Velg antall eller billetter",
  });

/**
 * POST /api/admin/orders/[orderNumber]/refund
 * Refunds some or all tickets at the payment provider, then voids them.
 * Checked-in tickets are never picked by `quantity`.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const rl = rateLimit(`admin-refund:${clientIp(req)}`, 20);
    if (!rl.success) throw new AppError("RATE_LIMITED", "For mange forespørsler", 429);

    const { orderNumber } = await ctx.params;
    const { user, order } = await requireOrderManageAccess(orderNumber);

    const org = await prisma.organization.findUnique({
      where: { id: order.organizationId },
      select: { allowRefunds: true },
    });
    if (!canRefund(user, order.organizationId, org?.allowRefunds ?? true)) {
      throw new AppError("FORBIDDEN", "Du har ikke tilgang til å refundere", 403);
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Ugyldig data", 400);
    }

    let ticketIds = parsed.data.ticketIds;
    if (!ticketIds) {
      const refundable = await prisma.ticket.findMany({
        where: {
          orderId: order.id,
          status: { in: [TicketStatus.VALID, TicketStatus.TRANSFERRED] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (refundable.length < parsed.data.quantity!) {
        throw new AppError(
          "NOT_ENOUGH_REFUNDABLE",
          `Bare ${refundable.length} ubrukte billett(er) kan refunderes`,
          409
        );
      }
      ticketIds = refundable.slice(0, parsed.data.quantity!).map((t) => t.id);
    }

    const refund = await RefundService.refundOrder({
      orderId: order.id,
      ticketIds,
      reason: parsed.data.reason || "Refundert av arrangør",
      actorId: user.id,
      ipAddress: clientIp(req),
      organizationId: order.organizationId,
    });

    return NextResponse.json({
      ok: true,
      refunded: ticketIds.length,
      amount: refund.amount,
      currency: refund.currency,
    });
  } catch (e) {
    return jsonError(e);
  }
}
