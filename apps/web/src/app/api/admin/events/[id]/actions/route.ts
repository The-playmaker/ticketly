import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { InventoryService } from "@/services/inventory-service";
import { EventService } from "@/services/event-service";
import { jsonError, AppError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";

type Props = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause_sales") }),
  z.object({ action: z.literal("resume_sales") }),
  z.object({ action: z.literal("publish") }),
  z.object({
    action: z.literal("release"),
    ticketTypeId: z.string(),
    amount: z.number().int().min(1).max(10000),
  }),
  z.object({
    action: z.literal("reduce_release"),
    ticketTypeId: z.string(),
    newReleased: z.number().int().min(0),
  }),
  z.object({
    action: z.literal("change_price"),
    ticketTypeId: z.string(),
    newPrice: z.number().int().min(0),
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("pause_ticket_type"),
    ticketTypeId: z.string(),
  }),
  z.object({
    action: z.literal("resume_ticket_type"),
    ticketTypeId: z.string(),
  }),
]);

async function assertAccess(eventId: string) {
  const session = await auth();
  if (!session?.user) throw new AppError("UNAUTHORIZED", "Innlogging kreves", 401);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError("NOT_FOUND", "Ikke funnet", 404);
  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };
  if (!canManageEvents(user, event.organizationId) && !isSuperAdmin(user)) {
    throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
  }
  return { user, event };
}

export async function POST(req: Request, { params }: Props) {
  try {
    const { id } = await params;
    const { user } = await assertAccess(id);
    const body = actionSchema.parse(await req.json());

    switch (body.action) {
      case "pause_sales":
        return NextResponse.json(await InventoryService.pauseEventSales(id, user.id));
      case "resume_sales":
        return NextResponse.json(await InventoryService.resumeEventSales(id, user.id));
      case "publish": {
        const published = await EventService.publish(id, user.id);
        await writeAuditLog({
          actorId: user.id,
          organizationId: published.organizationId,
          action: "EVENT_PUBLISHED",
          entityType: "Event",
          entityId: id,
        });
        return NextResponse.json(published);
      }
      case "release":
        return NextResponse.json(
          await InventoryService.releaseMore({
            ticketTypeId: body.ticketTypeId,
            amount: body.amount,
            actorId: user.id,
          })
        );
      case "reduce_release":
        return NextResponse.json(
          await InventoryService.reduceReleased({
            ticketTypeId: body.ticketTypeId,
            newReleased: body.newReleased,
            actorId: user.id,
          })
        );
      case "change_price":
        return NextResponse.json(
          await InventoryService.changePrice({
            ticketTypeId: body.ticketTypeId,
            newPrice: body.newPrice,
            reason: body.reason,
            actorId: user.id,
          })
        );
      case "pause_ticket_type":
        return NextResponse.json(await InventoryService.pauseTicketType(body.ticketTypeId, user.id));
      case "resume_ticket_type":
        return NextResponse.json(await InventoryService.resumeTicketType(body.ticketTypeId, user.id));
      default:
        throw new AppError("UNKNOWN_ACTION", "Ukjent handling", 400);
    }
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

export async function GET(_req: Request, { params }: Props) {
  try {
    const { id } = await params;
    await assertAccess(id);
    const summary = await InventoryService.getEventInventorySummary(id);
    return NextResponse.json(summary);
  } catch (e) {
    return jsonError(e);
  }
}
