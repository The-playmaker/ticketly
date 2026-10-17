import { put, del, list } from "@vercel/blob";
import { nanoid } from "nanoid";
import { AppError } from "@/lib/api-error";

export const COVER_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const COVER_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type CoverMime = (typeof COVER_ALLOWED_MIME)[number];

const MIME_EXT: Record<CoverMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** JPEG / PNG / WebP magic-byte detection (ignores client-supplied Content-Type). */
export function detectImageMime(bytes: Uint8Array): CoverMime | null {
  if (bytes.length < 12) return null;
  // JPEG FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function requireBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new AppError(
      "BLOB_NOT_CONFIGURED",
      "Bildeopplasting er ikke konfigurert (BLOB_READ_WRITE_TOKEN mangler)",
      503
    );
  }
  return token;
}

/** True when URL is from our Vercel Blob store (public or private hostnames). */
export function isOurBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host.endsWith(".public.blob.vercel-storage.com") ||
      host.endsWith(".blob.vercel-storage.com") ||
      host === "blob.vercel-storage.com"
    );
  } catch {
    return false;
  }
}

/** Path must be scoped to this event so cross-event assignment is blocked. */
export function isEventScopedBlobUrl(url: string, eventId: string): boolean {
  if (!isOurBlobUrl(url)) return false;
  try {
    const { pathname } = new URL(url);
    return pathname.includes(`/events/${eventId}/`);
  } catch {
    return false;
  }
}

export function coverBlobPathname(eventId: string, mime: CoverMime): string {
  return `events/${eventId}/cover-${nanoid(16)}.${MIME_EXT[mime]}`;
}

export async function validateCoverBuffer(buffer: ArrayBuffer | Uint8Array): Promise<{
  mime: CoverMime;
  bytes: Uint8Array;
}> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength === 0) {
    throw new AppError("EMPTY_FILE", "Filen er tom", 400);
  }
  if (bytes.byteLength > COVER_MAX_BYTES) {
    throw new AppError(
      "FILE_TOO_LARGE",
      "Bildet er for stort. Maksimal størrelse er 10 MB.",
      400
    );
  }
  const mime = detectImageMime(bytes);
  if (!mime) {
    throw new AppError(
      "INVALID_IMAGE_TYPE",
      "Ugyldig bildeformat. Kun JPG, PNG og WebP er tillatt.",
      400
    );
  }
  return { mime, bytes };
}

export async function uploadEventCover(params: {
  eventId: string;
  buffer: ArrayBuffer | Uint8Array;
  contentTypeHint?: string | null;
}): Promise<{ url: string; pathname: string; contentType: CoverMime }> {
  const token = requireBlobToken();
  const { mime, bytes } = await validateCoverBuffer(params.buffer);
  const pathname = coverBlobPathname(params.eventId, mime);
  const blob = await put(pathname, Buffer.from(bytes), {
    access: "public",
    token,
    contentType: mime,
    addRandomSuffix: false,
  });
  return { url: blob.url, pathname: blob.pathname, contentType: mime };
}

/**
 * Delete a blob URL only if it belongs to our store.
 * Caller should check shared usage across events before calling.
 */
export async function deleteBlobIfOurs(url: string | null | undefined): Promise<boolean> {
  if (!url || !isOurBlobUrl(url)) return false;
  const token = requireBlobToken();
  try {
    await del(url, { token });
    return true;
  } catch (err) {
    console.error("[blob] delete failed", err);
    return false;
  }
}

/** Best-effort: list blobs under event prefix (for orphan cleanup diagnostics). */
export async function listEventCoverBlobs(eventId: string) {
  const token = requireBlobToken();
  return list({ prefix: `events/${eventId}/cover-`, token });
}
