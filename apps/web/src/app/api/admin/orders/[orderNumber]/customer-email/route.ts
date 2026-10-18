import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrderManageAccess } from "@/lib/admin/org-access";
import { AppError, jsonError } from "@/lib/api-error";
import { clientIp } from "@/lib/security/rate-limit";
import { OrderEmailService, customerEmailSchema } from "@/services/order-email-service";

type Ctx = { params: Promise<{ orderNumber: string }> };

const bodySchema = z.object({
  email: customerEmailSchema,
});

/**
 * PATCH /api/admin/orders/[orderNumber]/customer-email
 * Body: { "email": "new@example.com" }
 * SUPER_ADMIN or org admin/manager with order access.
 * Updates Order.customerEmail only — never Stripe/payment data.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { orderNumber } = await ctx.params;
    const { user } = await requireOrderManageAccess(orderNumber);
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Ugyldig e-postadresse", 400);
    }

    const result = await OrderEmailService.updateCustomerEmail({
      orderNumber,
      email: parsed.data.email,
      actorId: user.id,
      ipAddress: clientIp(req),
    });

    return NextResponse.json({
      email: result.email,
      unchanged: result.unchanged,
      audit: result.audit,
    });
  } catch (e) {
    return jsonError(e);
  }
}
