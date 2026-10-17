import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { jsonError, AppError } from "@/lib/api-error";
import { clientIp } from "@/lib/security/rate-limit";
import { TEST_EVENT_RESET_CONFIRMATION } from "@/lib/admin/event-test-reset";
import { EventTestResetService } from "@/services/event-test-reset-service";

type Ctx = { params: Promise<{ id: string }> };

const legacyBodySchema = z.object({
  dryRun: z.boolean().optional(),
  confirm: z.string().optional(),
  confirmation: z.string().optional(),
  allowEmergencyOverride: z.boolean().optional(),
  emergencyConfirmation: z.string().optional(),
  allowProductionOverride: z.boolean().optional(),
  productionConfirmation: z.string().optional(),
});

/**
 * Legacy alias of /api/admin/events/[id]/reset-test-data.
 * Prefer GET|POST on reset-test-data. This route still accepts
 * `{ "dryRun": true }` and `{ "dryRun": false, "confirmation": "RESET TEST EVENT" }`.
 */
export { GET } from "../reset-test-data/route";

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

    const body = legacyBodySchema.parse(raw);
    const confirm = body.confirm ?? body.confirmation;
    const wantsExecute = body.dryRun === false || Boolean(confirm);

    if (!wantsExecute) {
      const result = await EventTestResetService.preview(id);
      return NextResponse.json(result);
    }

    if (confirm !== TEST_EVENT_RESET_CONFIRMATION) {
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        `Bekreftelse mangler eller er feil. Skriv nøyaktig: ${TEST_EVENT_RESET_CONFIRMATION}`,
        400
      );
    }

    const result = await EventTestResetService.reset({
      eventId: id,
      actorId: user.id,
      confirm,
      allowEmergencyOverride:
        body.allowEmergencyOverride ?? body.allowProductionOverride,
      emergencyConfirmation:
        body.emergencyConfirmation ?? body.productionConfirmation,
      ipAddress: clientIp(req),
    });

    revalidatePath(`/admin/events/${id}`);
    revalidatePath(`/admin/events/${id}/settings`);
    revalidatePath(`/admin/events/${id}/security`);
    revalidatePath(`/admin/events/${id}/orders`);
    revalidatePath(`/admin/events/${id}/attendees`);
    revalidatePath(`/admin/events/${id}/analytics`);

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
