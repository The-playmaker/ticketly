import { NextResponse } from "next/server";
import { requireOrderManageAccess } from "@/lib/admin/org-access";
import { jsonError } from "@/lib/api-error";
import { clientIp } from "@/lib/security/rate-limit";
import { OrderEmailService } from "@/services/order-email-service";

type Ctx = { params: Promise<{ orderNumber: string }> };

/**
 * POST /api/admin/orders/[orderNumber]/resend-email
 * Re-sends confirmation + ticket delivery for PAID / PARTIALLY_REFUNDED orders.
 * Never creates tickets or mutates payment/inventory.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { orderNumber } = await ctx.params;
    const { user } = await requireOrderManageAccess(orderNumber);

    const result = await OrderEmailService.resendOrderEmails({
      orderNumber,
      actorId: user.id,
      ipAddress: clientIp(req),
    });

    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
