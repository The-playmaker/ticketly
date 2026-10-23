import { NextResponse } from "next/server";
import { z } from "zod";
import { EventService } from "@/services/event-service";
import { requireEventManageAccess } from "@/lib/admin/org-access";
import { jsonError } from "@/lib/api-error";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  waitlistEnabled: z.boolean().optional(),
  waitlistOnReleaseSoldOut: z.boolean().optional(),
  reminder24hEnabled: z.boolean().optional(),
  reminder3hEnabled: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user } = await requireEventManageAccess(id);
    const body = bodySchema.parse(await req.json());
    const updated = await EventService.update(
      id,
      {
        ...(body.waitlistEnabled !== undefined ? { waitlistEnabled: body.waitlistEnabled } : {}),
        ...(body.waitlistOnReleaseSoldOut !== undefined
          ? { waitlistOnReleaseSoldOut: body.waitlistOnReleaseSoldOut }
          : {}),
        ...(body.reminder24hEnabled !== undefined
          ? { reminder24hEnabled: body.reminder24hEnabled }
          : {}),
        ...(body.reminder3hEnabled !== undefined
          ? { reminder3hEnabled: body.reminder3hEnabled }
          : {}),
      },
      user.id
    );
    return NextResponse.json({ event: updated });
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
