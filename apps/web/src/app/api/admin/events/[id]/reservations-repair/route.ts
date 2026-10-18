import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/admin/org-access";
import { prisma } from "@/lib/db";
import { jsonError, AppError } from "@/lib/api-error";
import { ReservationService } from "@/services/reservation-service";

type Props = { params: Promise<{ id: string }> };

/**
 * SUPER_ADMIN: dry-run (GET) or apply (POST) reservation inventory repair.
 */
export async function GET(_req: Request, { params }: Props) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) throw new AppError("NOT_FOUND", "Arrangement ikke funnet", 404);

    const result = await ReservationService.repairEvent({ eventId: id, apply: false });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request, { params }: Props) {
  try {
    const { user } = await requireSuperAdmin();
    const { id } = await params;
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) throw new AppError("NOT_FOUND", "Arrangement ikke funnet", 404);

    const body = (await req.json().catch(() => ({}))) as { apply?: boolean };
    const apply = body.apply !== false;

    const result = await ReservationService.repairEvent({
      eventId: id,
      apply,
      actorId: user.id,
    });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
