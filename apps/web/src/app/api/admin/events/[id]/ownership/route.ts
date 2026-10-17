import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EventService } from "@/services/event-service";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { prisma } from "@/lib/db";
import { jsonError, AppError } from "@/lib/api-error";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  organizationId: z.string().min(1),
  sellerOrganizationId: z.string().min(1),
});

/**
 * PATCH /api/admin/events/[id]/ownership
 * SUPER_ADMIN only — move organizer / juridisk selger without recreating the event.
 * Historical Order.*OrganizationId and OrderSnapshot rows are left untouched.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { user } = await requireSuperAdmin();
    const { id } = await ctx.params;

    const existing = await prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND", "Arrangement ikke funnet", 404);

    const body = bodySchema.parse(await req.json());
    const event = await EventService.updateOwnership(
      id,
      {
        organizationId: body.organizationId,
        sellerOrganizationId: body.sellerOrganizationId,
      },
      user.id
    );

    revalidatePath("/admin/events");
    revalidatePath(`/admin/events/${id}`);
    revalidatePath(`/admin/events/${id}/settings`);

    return NextResponse.json({ event });
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
