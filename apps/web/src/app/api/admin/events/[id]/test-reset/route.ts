import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { jsonError, AppError } from "@/lib/api-error";
import { clientIp } from "@/lib/security/rate-limit";
import {
  PRODUCTION_EVENT_RESET_CONFIRMATION,
  TEST_EVENT_RESET_CONFIRMATION,
} from "@/lib/admin/event-test-reset";
import { EventTestResetService } from "@/services/event-test-reset-service";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  dryRun: z.boolean(),
  confirmation: z.string().optional(),
  allowProductionOverride: z.boolean().optional(),
  productionConfirmation: z.string().optional(),
});

/**
 * POST /api/admin/events/[id]/test-reset
 *
 * SUPER_ADMIN only. Dry-run inventories sales/test rows for THIS event;
 * confirmed reset deletes them and zeros TicketType.quantitySold/Reserved.
 *
 * Safety gates:
 * - Exact confirmation `RESET TEST EVENT` required when dryRun=false
 * - Production gate blocks paid real-customer orders OR live status with revenue > 0
 *   unless ALLOW_PRODUCTION_EVENT_RESET=true + allowProductionOverride +
 *   productionConfirmation `I UNDERSTAND THIS IS PRODUCTION`
 *
 * Does not touch other events/organizations. Preserves Event, quantityTotal,
 * quantityReleased, price, and event config.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { user } = await requireSuperAdmin();
    const { id } = await ctx.params;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError("VALIDATION_ERROR", "Ugyldig JSON", 400);
    }

    const body = bodySchema.parse(raw);

    if (!body.dryRun) {
      if (body.confirmation !== TEST_EVENT_RESET_CONFIRMATION) {
        throw new AppError(
          "CONFIRMATION_REQUIRED",
          `Bekreftelse mangler eller er feil. Skriv nøyaktig: ${TEST_EVENT_RESET_CONFIRMATION}`,
          400
        );
      }
      if (
        body.allowProductionOverride &&
        body.productionConfirmation &&
        body.productionConfirmation !== PRODUCTION_EVENT_RESET_CONFIRMATION
      ) {
        throw new AppError(
          "CONFIRMATION_REQUIRED",
          `Produksjonsbekreftelse mangler eller er feil. Skriv nøyaktig: ${PRODUCTION_EVENT_RESET_CONFIRMATION}`,
          400
        );
      }
    }

    const result = await EventTestResetService.reset({
      eventId: id,
      actorId: user.id,
      dryRun: body.dryRun,
      confirmation: body.confirmation,
      allowProductionOverride: body.allowProductionOverride,
      productionConfirmation: body.productionConfirmation,
      ipAddress: clientIp(req),
    });

    if (!body.dryRun) {
      revalidatePath(`/admin/events/${id}`);
      revalidatePath(`/admin/events/${id}/settings`);
      revalidatePath(`/admin/events/${id}/security`);
      revalidatePath(`/admin/events/${id}/orders`);
      revalidatePath(`/admin/events/${id}/attendees`);
      revalidatePath(`/admin/events/${id}/analytics`);
    }

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Ugyldig data" } },
        { status: 400 }
      );
    }
    return jsonError(e);
  }
}
