import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageEvents, isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { EventService } from "@/services/event-service";
import { jsonError, AppError } from "@/lib/api-error";
import { slugify } from "@/lib/utils";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
  shortDescription: z.string().max(300).optional(),
  category: z.string().optional(),
  coverImageUrl: z.string().url().optional().or(z.literal("")),
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default("NO"),
  timezone: z.string().default("Europe/Oslo"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  doorsOpenAt: z.string().datetime().optional(),
  ageLimit: z.number().int().min(0).max(99).optional(),
  capacity: z.number().int().min(1),
  serviceFee: z.number().int().min(0).optional(),
  currency: z.string().default("NOK"),
  sellerOrganizationId: z.string().optional(),
  refundPolicyText: z.string().optional(),
  ticket: z.object({
    name: z.string().min(1),
    price: z.number().int().min(0),
    quantityTotal: z.number().int().min(1),
    quantityReleased: z.number().int().min(0),
    maxPerOrder: z.number().int().min(1).default(6),
  }),
  publish: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) throw new AppError("UNAUTHORIZED", "Innlogging kreves", 401);

    const user = {
      id: session.user.id,
      email: session.user.email!,
      globalRole: session.user.globalRole,
      isActive: true,
      memberships: session.user.memberships,
    };

    const body = createSchema.parse(await req.json());
    if (!canManageEvents(user, body.organizationId) && !isSuperAdmin(user)) {
      throw new AppError("FORBIDDEN", "Ingen tilgang", 403);
    }

    if (body.ticket.quantityReleased > body.ticket.quantityTotal) {
      throw new AppError("INVALID_RELEASE", "Initial release kan ikke overstige total", 400);
    }
    if (body.ticket.quantityTotal > body.capacity) {
      throw new AppError("INVALID_CAPACITY", "Billettallokering kan ikke overstige eventkapasitet", 400);
    }

    const slug = body.slug || slugify(body.name);
    const sellerId = body.sellerOrganizationId || body.organizationId;

    const event = await EventService.create(
      {
        organizationId: body.organizationId,
        sellerOrganizationId: sellerId,
        name: body.name,
        slug,
        description: body.description,
        shortDescription: body.shortDescription,
        category: body.category,
        coverImageUrl: body.coverImageUrl || null,
        address: body.address,
        postalCode: body.postalCode,
        city: body.city,
        country: body.country,
        timezone: body.timezone,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        doorsOpenAt: body.doorsOpenAt ? new Date(body.doorsOpenAt) : null,
        ageLimit: body.ageLimit,
        capacity: body.capacity,
        serviceFee: body.serviceFee ?? 2000,
        currency: body.currency,
        refundPolicyText: body.refundPolicyText,
        status: body.publish ? "PUBLISHED" : "DRAFT",
        visibility: "PUBLIC",
      },
      user.id
    );

    await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: body.ticket.name,
        price: body.ticket.price,
        quantityTotal: body.ticket.quantityTotal,
        quantityReleased: body.ticket.quantityReleased,
        maxPerOrder: body.ticket.maxPerOrder,
        minPerOrder: 1,
        isVisible: true,
        isPubliclyPurchasable: true,
        sortOrder: 0,
      },
    });

    if (body.publish) {
      await writeAuditLog({
        actorId: user.id,
        organizationId: event.organizationId,
        action: "EVENT_PUBLISHED",
        entityType: "Event",
        entityId: event.id,
      });
    }

    return NextResponse.json({
      id: event.id,
      slug: event.slug,
      status: event.status,
      publicUrl: `/events/${event.slug}`,
    });
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
