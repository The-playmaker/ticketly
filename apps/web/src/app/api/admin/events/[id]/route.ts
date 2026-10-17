import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EventStatus, Visibility } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireEventManageAccess } from "@/lib/admin/org-access";
import { jsonError, AppError } from "@/lib/api-error";
import { isEventScopedBlobUrl, isOurBlobUrl } from "@/lib/blob/cover-image";
import { writeAuditLog } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

const ticketTypePatchSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().int().min(0),
  quantityTotal: z.number().int().min(0),
  quantityReleased: z.number().int().min(0).optional(),
  maxPerOrder: z.number().int().min(1).max(50).default(10),
  minPerOrder: z.number().int().min(1).max(50).default(1),
  salesStartAt: z.string().datetime().optional().nullable(),
  salesEndAt: z.string().datetime().optional().nullable(),
  isVisible: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  _delete: z.boolean().optional(),
});

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(50_000).optional().nullable(),
  shortDescription: z.string().max(300).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  country: z.string().max(2).optional(),
  timezone: z.string().max(64).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  doorsOpenAt: z.string().datetime().optional().nullable(),
  ageLimit: z.number().int().min(0).max(99).optional().nullable(),
  capacity: z.number().int().min(1).optional(),
  status: z.nativeEnum(EventStatus).optional(),
  visibility: z.nativeEnum(Visibility).optional(),
  salesStartAt: z.string().datetime().optional().nullable(),
  salesEndAt: z.string().datetime().optional().nullable(),
  /** Only null/empty clears; non-empty must be our event-scoped blob URL. */
  coverImageUrl: z.string().url().optional().nullable().or(z.literal("")),
  venueName: z.string().max(200).optional().nullable(),
  ticketTypes: z.array(ticketTypePatchSchema).optional(),
});

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return new Date(value);
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { event } = await requireEventManageAccess(id);
    const full = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      include: {
        organization: { select: { id: true, name: true, legalName: true } },
        sellerOrganization: { select: { id: true, name: true, legalName: true } },
        venue: true,
        ticketTypes: { orderBy: { sortOrder: "asc" } },
      },
    });
    return NextResponse.json({ event: full });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, event } = await requireEventManageAccess(id);
    const body = patchSchema.parse(await req.json());

    if (body.startsAt && body.endsAt) {
      if (new Date(body.endsAt) <= new Date(body.startsAt)) {
        throw new AppError("INVALID_DATES", "Sluttid må være etter starttid", 400);
      }
    }

    if (body.coverImageUrl !== undefined) {
      const next = body.coverImageUrl || null;
      if (next) {
        if (!isOurBlobUrl(next) || !isEventScopedBlobUrl(next, event.id)) {
          throw new AppError(
            "INVALID_COVER_URL",
            "Cover-bilde må lastes opp via Ticketly (ugyldig Blob-URL)",
            400
          );
        }
      }
    }

    const existingTypes = await prisma.ticketType.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    });

    if (body.ticketTypes) {
      const capacity = body.capacity ?? event.capacity;
      const kept = body.ticketTypes.filter((t) => !t._delete);
      const allocation = kept.reduce((s, t) => s + t.quantityTotal, 0);
      if (allocation > capacity) {
        throw new AppError(
          "INVALID_CAPACITY",
          "Samlet billettallokering kan ikke overstige eventkapasitet",
          400
        );
      }
      for (const t of kept) {
        if (t.quantityReleased != null && t.quantityReleased > t.quantityTotal) {
          throw new AppError(
            "INVALID_RELEASE",
            `Release for «${t.name}» kan ikke overstige total`,
            400
          );
        }
        if (t.id) {
          const prev = existingTypes.find((x) => x.id === t.id);
          if (!prev || prev.eventId !== event.id) {
            throw new AppError("TICKET_TYPE_NOT_FOUND", "Billettype ikke funnet", 404);
          }
          const released = t.quantityReleased ?? prev.quantityReleased;
          if (t.quantityTotal < prev.quantitySold) {
            throw new AppError(
              "INVALID_CAPACITY",
              `Kan ikke sette total under solgte (${prev.quantitySold}) for «${t.name}»`,
              400
            );
          }
          if (released < prev.quantitySold + prev.quantityReserved) {
            throw new AppError(
              "INVALID_RELEASE",
              `Release for «${t.name}» kan ikke være under solgt+reservert`,
              400
            );
          }
        }
      }
      for (const t of body.ticketTypes.filter((x) => x._delete && x.id)) {
        const prev = existingTypes.find((x) => x.id === t.id);
        if (prev && (prev.quantitySold > 0 || prev.quantityReserved > 0)) {
          throw new AppError(
            "TICKET_TYPE_IN_USE",
            `Kan ikke slette «${prev.name}» — det finnes solgte eller reserverte billetter`,
            409
          );
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      let venueId = event.venueId;
      if (body.venueName !== undefined) {
        const name = body.venueName?.trim() || null;
        if (!name) {
          venueId = null;
        } else if (event.venueId) {
          await tx.venue.update({
            where: { id: event.venueId },
            data: {
              name,
              ...(body.address !== undefined ? { address: body.address } : {}),
              ...(body.city !== undefined ? { city: body.city } : {}),
              ...(body.postalCode !== undefined ? { postalCode: body.postalCode } : {}),
            },
          });
        } else {
          const venue = await tx.venue.create({
            data: {
              organizationId: event.organizationId,
              name,
              address: body.address ?? event.address,
              city: body.city ?? event.city,
              postalCode: body.postalCode ?? event.postalCode,
              country: body.country ?? event.country,
            },
          });
          venueId = venue.id;
        }
      }

      const eventData: Prisma.EventUncheckedUpdateInput = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.shortDescription !== undefined
          ? { shortDescription: body.shortDescription }
          : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.postalCode !== undefined ? { postalCode: body.postalCode } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
        ...(body.doorsOpenAt !== undefined
          ? { doorsOpenAt: parseDate(body.doorsOpenAt) }
          : {}),
        ...(body.ageLimit !== undefined ? { ageLimit: body.ageLimit } : {}),
        ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        ...(body.salesStartAt !== undefined
          ? { salesStartAt: parseDate(body.salesStartAt) }
          : {}),
        ...(body.salesEndAt !== undefined ? { salesEndAt: parseDate(body.salesEndAt) } : {}),
        ...(body.coverImageUrl !== undefined
          ? { coverImageUrl: body.coverImageUrl || null }
          : {}),
        ...(venueId !== event.venueId ? { venueId } : {}),
      };

      const saved = await tx.event.update({
        where: { id: event.id },
        data: eventData,
      });

      if (body.ticketTypes) {
        for (const t of body.ticketTypes) {
          if (t._delete && t.id) {
            await tx.ticketType.delete({ where: { id: t.id } });
            continue;
          }
          if (t._delete) continue;

          const salesStartAt = parseDate(t.salesStartAt ?? undefined);
          const salesEndAt = parseDate(t.salesEndAt ?? undefined);

          if (t.id) {
            const prev = existingTypes.find((x) => x.id === t.id)!;
            await tx.ticketType.update({
              where: { id: t.id },
              data: {
                name: t.name,
                description: t.description ?? null,
                price: t.price,
                quantityTotal: t.quantityTotal,
                quantityReleased: t.quantityReleased ?? prev.quantityReleased,
                maxPerOrder: t.maxPerOrder,
                minPerOrder: t.minPerOrder,
                salesStartAt: salesStartAt === undefined ? prev.salesStartAt : salesStartAt,
                salesEndAt: salesEndAt === undefined ? prev.salesEndAt : salesEndAt,
                isVisible: t.isVisible ?? prev.isVisible,
                sortOrder: t.sortOrder ?? prev.sortOrder,
              },
            });
          } else {
            await tx.ticketType.create({
              data: {
                eventId: event.id,
                name: t.name,
                description: t.description ?? null,
                price: t.price,
                quantityTotal: t.quantityTotal,
                quantityReleased: t.quantityReleased ?? 0,
                maxPerOrder: t.maxPerOrder,
                minPerOrder: t.minPerOrder,
                salesStartAt: salesStartAt ?? null,
                salesEndAt: salesEndAt ?? null,
                isVisible: t.isVisible ?? true,
                isPubliclyPurchasable: true,
                sortOrder: t.sortOrder ?? existingTypes.length,
              },
            });
          }
        }
      }

      return saved;
    });

    await writeAuditLog({
      actorId: user.id,
      organizationId: updated.organizationId,
      action: "EVENT_UPDATED",
      entityType: "Event",
      entityId: updated.id,
      metadata: {
        fields: Object.keys(body),
        ticketTypeCount: body.ticketTypes?.length,
      },
    });

    revalidatePath(`/admin/events/${event.id}`);
    revalidatePath(`/admin/events/${event.id}/edit`);
    revalidatePath(`/admin/events/${event.id}/settings`);
    revalidatePath(`/events/${updated.slug}`);
    revalidatePath("/admin/events");
    revalidatePath("/");

    const full = await prisma.event.findUniqueOrThrow({
      where: { id: updated.id },
      include: {
        ticketTypes: { orderBy: { sortOrder: "asc" } },
        venue: true,
      },
    });

    return NextResponse.json({ event: full });
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
