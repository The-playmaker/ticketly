import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { jsonError, AppError } from "@/lib/api-error";
import { clientIp } from "@/lib/security/rate-limit";
import {
  EMERGENCY_EVENT_RESET_CONFIRMATION,
  TEST_EVENT_RESET_CONFIRMATION,
} from "@/lib/admin/event-test-reset";
import { EventTestResetService } from "@/services/event-test-reset-service";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  confirm: z.string().optional(),
  /** @deprecated prefer confirm */
  confirmation: z.string().optional(),
  allowEmergencyOverride: z.boolean().optional(),
  emergencyConfirmation: z.string().optional(),
  /** @deprecated aliases for emergency override */
  allowProductionOverride: z.boolean().optional(),
  productionConfirmation: z.string().optional(),
});

function revalidateEventPaths(id: string) {
  revalidatePath(`/admin/events/${id}`);
  revalidatePath(`/admin/events/${id}/settings`);
  revalidatePath(`/admin/events/${id}/security`);
  revalidatePath(`/admin/events/${id}/orders`);
  revalidatePath(`/admin/events/${id}/attendees`);
  revalidatePath(`/admin/events/${id}/analytics`);
}

/**
 * GET /api/admin/events/[id]/reset-test-data
 *
 * SUPER_ADMIN dry-run: inventory of operational rows for THIS event + safety gate.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    await requireSuperAdmin();
    const { id } = await ctx.params;
    const result = await EventTestResetService.preview(id);
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * POST /api/admin/events/[id]/reset-test-data
 *
 * SUPER_ADMIN only. Body: `{ "confirm": "RESET TEST EVENT" }`.
 *
 * Primary safety: all financial orders must be fully refunded (PAID /
 * PARTIALLY_REFUNDED / REVIEW_REQUIRED / AUTHORIZED block). Does not issue
 * refunds. Stripe remains external source of record.
 *
 * Emergency override (documented, off by default): ALLOW_PRODUCTION_EVENT_RESET=true
 * + allowEmergencyOverride + emergencyConfirmation `I UNDERSTAND THIS IS PRODUCTION`.
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
    const confirm = body.confirm ?? body.confirmation;
    if (confirm !== TEST_EVENT_RESET_CONFIRMATION) {
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        `Bekreftelse mangler eller er feil. Skriv nøyaktig: ${TEST_EVENT_RESET_CONFIRMATION}`,
        400
      );
    }

    const emergencyConfirmation =
      body.emergencyConfirmation ?? body.productionConfirmation;
    const allowEmergency =
      body.allowEmergencyOverride ?? body.allowProductionOverride;

    if (
      allowEmergency &&
      emergencyConfirmation &&
      emergencyConfirmation !== EMERGENCY_EVENT_RESET_CONFIRMATION
    ) {
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        `Nødbekreftelse mangler eller er feil. Skriv nøyaktig: ${EMERGENCY_EVENT_RESET_CONFIRMATION}`,
        400
      );
    }

    const result = await EventTestResetService.reset({
      eventId: id,
      actorId: user.id,
      confirm,
      allowEmergencyOverride: allowEmergency,
      emergencyConfirmation,
      ipAddress: clientIp(req),
    });

    revalidateEventPaths(id);
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
