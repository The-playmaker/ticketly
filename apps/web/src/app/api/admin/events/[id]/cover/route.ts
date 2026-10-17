import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireEventManageAccess } from "@/lib/admin/org-access";
import { jsonError, AppError } from "@/lib/api-error";
import { clientIp, rateLimitAsync } from "@/lib/security/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  COVER_MAX_BYTES,
  deleteBlobIfOurs,
  isEventScopedBlobUrl,
  isOurBlobUrl,
  uploadEventCover,
  validateCoverBuffer,
} from "@/lib/blob/cover-image";

type Ctx = { params: Promise<{ id: string }> };

const assignSchema = z.object({
  url: z.string().url(),
});

async function maybeDeletePreviousCover(
  eventId: string,
  previousUrl: string | null,
  nextUrl: string | null
) {
  if (!previousUrl || previousUrl === nextUrl) return;
  if (!isOurBlobUrl(previousUrl)) return;
  const shared = await prisma.event.count({
    where: { coverImageUrl: previousUrl, NOT: { id: eventId } },
  });
  const seriesShared = await prisma.eventSeries.count({
    where: { coverImageUrl: previousUrl },
  });
  if (shared > 0 || seriesShared > 0) return;
  await deleteBlobIfOurs(previousUrl);
}

/**
 * POST multipart — server-side upload (magic-byte validation before put).
 * Body: FormData with field `file`.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, event } = await requireEventManageAccess(id);

    const ip = clientIp(req);
    const rl = await rateLimitAsync(`cover-upload:${user.id}:${ip}`, 20, 60_000);
    if (!rl.success) {
      throw new AppError(
        "RATE_LIMITED",
        "For mange opplastinger. Vent litt og prøv igjen.",
        429
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AppError("MISSING_FILE", "Ingen fil mottatt", 400);
    }
    if (file.size > COVER_MAX_BYTES) {
      throw new AppError(
        "FILE_TOO_LARGE",
        "Bildet er for stort. Maksimal størrelse er 10 MB.",
        400
      );
    }

    const buffer = await file.arrayBuffer();
    await validateCoverBuffer(buffer);
    const uploaded = await uploadEventCover({
      eventId: event.id,
      buffer,
      contentTypeHint: file.type,
    });

    const previousUrl = event.coverImageUrl;
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { coverImageUrl: uploaded.url },
    });

    await maybeDeletePreviousCover(event.id, previousUrl, uploaded.url);

    await writeAuditLog({
      actorId: user.id,
      organizationId: event.organizationId,
      action: "EVENT_COVER_UPLOADED",
      entityType: "Event",
      entityId: event.id,
      metadata: { url: uploaded.url, contentType: uploaded.contentType },
    });

    revalidatePath(`/admin/events/${event.id}`);
    revalidatePath(`/admin/events/${event.id}/edit`);
    revalidatePath(`/events/${updated.slug}`);
    revalidatePath("/");

    return NextResponse.json({
      coverImageUrl: updated.coverImageUrl,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * PUT JSON — assign a client-uploaded Blob URL (token flow).
 * Validates hostname + event-scoped path; does not trust arbitrary URLs.
 */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, event } = await requireEventManageAccess(id);

    const ip = clientIp(req);
    const rl = await rateLimitAsync(`cover-assign:${user.id}:${ip}`, 30, 60_000);
    if (!rl.success) {
      throw new AppError(
        "RATE_LIMITED",
        "For mange forespørsler. Vent litt og prøv igjen.",
        429
      );
    }

    const body = assignSchema.parse(await req.json());
    if (!isEventScopedBlobUrl(body.url, event.id)) {
      throw new AppError(
        "INVALID_COVER_URL",
        "Cover-bilde må lastes opp via Ticketly (ugyldig Blob-URL)",
        400
      );
    }

    // Fetch first bytes to verify magic (prevents HTML/SVG masquerading as image).
    const head = await fetch(body.url, {
      headers: { Range: "bytes=0-31" },
    });
    if (!head.ok && head.status !== 206) {
      throw new AppError(
        "INVALID_COVER_URL",
        "Kunne ikke verifisere opplastet bilde. Prøv igjen.",
        400
      );
    }
    const probe = new Uint8Array(await head.arrayBuffer());
    await validateCoverBuffer(probe.length >= 12 ? probe : await (await fetch(body.url)).arrayBuffer());

    const previousUrl = event.coverImageUrl;
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { coverImageUrl: body.url },
    });

    await maybeDeletePreviousCover(event.id, previousUrl, body.url);

    await writeAuditLog({
      actorId: user.id,
      organizationId: event.organizationId,
      action: "EVENT_COVER_ASSIGNED",
      entityType: "Event",
      entityId: event.id,
      metadata: { url: body.url },
    });

    revalidatePath(`/admin/events/${event.id}`);
    revalidatePath(`/admin/events/${event.id}/edit`);
    revalidatePath(`/events/${updated.slug}`);
    revalidatePath("/");

    return NextResponse.json({
      coverImageUrl: updated.coverImageUrl,
      updatedAt: updated.updatedAt.toISOString(),
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

/** DELETE — clear cover; delete blob only if not shared. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, event } = await requireEventManageAccess(id);

    const ip = clientIp(req);
    const rl = await rateLimitAsync(`cover-delete:${user.id}:${ip}`, 20, 60_000);
    if (!rl.success) {
      throw new AppError(
        "RATE_LIMITED",
        "For mange forespørsler. Vent litt og prøv igjen.",
        429
      );
    }

    const previousUrl = event.coverImageUrl;
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { coverImageUrl: null },
    });

    await maybeDeletePreviousCover(event.id, previousUrl, null);

    await writeAuditLog({
      actorId: user.id,
      organizationId: event.organizationId,
      action: "EVENT_COVER_REMOVED",
      entityType: "Event",
      entityId: event.id,
      metadata: { previousUrl },
    });

    revalidatePath(`/admin/events/${event.id}`);
    revalidatePath(`/admin/events/${event.id}/edit`);
    revalidatePath(`/events/${updated.slug}`);
    revalidatePath("/");

    return NextResponse.json({
      coverImageUrl: null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (e) {
    return jsonError(e);
  }
}
