import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireEventManageAccess } from "@/lib/admin/org-access";
import { jsonError, AppError } from "@/lib/api-error";
import { clientIp, rateLimitAsync } from "@/lib/security/rate-limit";
import {
  COVER_ALLOWED_MIME,
  COVER_MAX_BYTES,
  coverBlobPathname,
  requireBlobToken,
} from "@/lib/blob/cover-image";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Short-lived client upload token for @vercel/blob `upload()`.
 * Auth: SUPER_ADMIN any event; organizer admin / event manager for own org only.
 * Door staff blocked via requireEventManageAccess.
 * Token never exposes BLOB_READ_WRITE_TOKEN to the browser beyond the short-lived upload credential.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { user, event } = await requireEventManageAccess(id);
    requireBlobToken();

    const ip = clientIp(req);
    const rl = await rateLimitAsync(`cover-token:${user.id}:${ip}`, 20, 60_000);
    if (!rl.success) {
      throw new AppError(
        "RATE_LIMITED",
        "For mange opplastinger. Vent litt og prøv igjen.",
        429
      );
    }

    const body = (await req.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        // Pathname is chosen client-side; we constrain type/size and stamp actor in payload.
        return {
          allowedContentTypes: [...COVER_ALLOWED_MIME],
          maximumSizeInBytes: COVER_MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            eventId: event.id,
            actorId: user.id,
            organizationId: event.organizationId,
          }),
        };
      },
      // Assignment happens via PUT /cover after client upload (validated + magic check).
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    return jsonError(e);
  }
}

/** Suggested unique pathname for client uploads (event-scoped). */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await requireEventManageAccess(id);
    // Default to jpg pathname; client may still upload png/webp — suffix randomized by blob.
    const pathname = coverBlobPathname(id, "image/jpeg");
    return NextResponse.json({ pathname });
  } catch (e) {
    return jsonError(e);
  }
}
