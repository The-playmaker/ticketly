import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  COVER_MAX_BYTES,
  detectImageMime,
  isEventScopedBlobUrl,
  isOurBlobUrl,
  validateCoverBuffer,
} from "@/lib/blob/cover-image";
import { withCoverCacheBust } from "@/lib/media/cover-url";
import { AppError } from "@/lib/api-error";

function jpegHeader(extra = 0): Uint8Array {
  const buf = new Uint8Array(12 + extra);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  return buf;
}

function pngHeader(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}

function webpHeader(): Uint8Array {
  const buf = new Uint8Array(12);
  buf.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return buf;
}

describe("cover image MIME / magic validation", () => {
  it("detects JPEG, PNG, WebP from magic bytes", () => {
    expect(detectImageMime(jpegHeader())).toBe("image/jpeg");
    expect(detectImageMime(pngHeader())).toBe("image/png");
    expect(detectImageMime(webpHeader())).toBe("image/webp");
    expect(detectImageMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("rejects invalid and oversized buffers with Norwegian errors", async () => {
    await expect(validateCoverBuffer(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: "INVALID_IMAGE_TYPE",
      message: expect.stringContaining("JPG, PNG og WebP"),
    });

    const huge = new Uint8Array(COVER_MAX_BYTES + 1);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    await expect(validateCoverBuffer(huge)).rejects.toBeInstanceOf(AppError);
    await expect(validateCoverBuffer(huge)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("accepts valid small JPEG buffer", async () => {
    const { mime } = await validateCoverBuffer(jpegHeader(100));
    expect(mime).toBe("image/jpeg");
  });
});

describe("blob URL trust boundaries", () => {
  it("accepts only Vercel Blob hosts", () => {
    expect(
      isOurBlobUrl("https://abc123.public.blob.vercel-storage.com/events/e1/cover-x.jpg")
    ).toBe(true);
    expect(isOurBlobUrl("https://evil.example.com/cover.jpg")).toBe(false);
    expect(isOurBlobUrl("https://images.unsplash.com/photo.jpg")).toBe(false);
  });

  it("requires event-scoped pathname", () => {
    const url = "https://abc.public.blob.vercel-storage.com/events/evt_1/cover-abc.jpg";
    expect(isEventScopedBlobUrl(url, "evt_1")).toBe(true);
    expect(isEventScopedBlobUrl(url, "evt_other")).toBe(false);
  });
});

describe("cover cache bust", () => {
  it("appends v query from updatedAt", () => {
    const busted = withCoverCacheBust(
      "https://abc.public.blob.vercel-storage.com/events/e1/cover.jpg",
      new Date("2026-10-17T12:00:00.000Z")
    );
    expect(busted).toContain("v=1760702400000");
  });

  it("returns null for missing url", () => {
    expect(withCoverCacheBust(null, 1)).toBeNull();
  });
});

describe("UI / API wiring for cover + edit", () => {
  it("event card and checkout use cache-busted covers", () => {
    const card = readFileSync(
      path.resolve(__dirname, "../../src/components/events/event-card.tsx"),
      "utf8"
    );
    expect(card).toContain("withCoverCacheBust");
    expect(card).toContain("aspect-[16/9]");

    const checkout = readFileSync(
      path.resolve(__dirname, "../../src/app/checkout/page.tsx"),
      "utf8"
    );
    expect(checkout).toContain("withCoverCacheBust");
    expect(checkout).toContain("checkout-cover");
  });

  it("edit page and Rediger arrangement CTAs exist", () => {
    const editPage = readFileSync(
      path.resolve(__dirname, "../../src/app/admin/events/[id]/edit/page.tsx"),
      "utf8"
    );
    expect(editPage).toContain("EditEventForm");
    expect(editPage).toContain("requireEventManageAccess");

    const dash = readFileSync(
      path.resolve(__dirname, "../../src/app/admin/events/[id]/page.tsx"),
      "utf8"
    );
    expect(dash).toContain("EditEventLink");

    const settings = readFileSync(
      path.resolve(__dirname, "../../src/app/admin/events/[id]/settings/page.tsx"),
      "utf8"
    );
    expect(settings).toContain("EditEventLink");

    const link = readFileSync(
      path.resolve(__dirname, "../../src/components/admin/edit-event-link.tsx"),
      "utf8"
    );
    expect(link).toContain("Rediger arrangement");
  });

  it("cover upload API uses manage access, rate limit, and Norwegian errors", () => {
    const route = readFileSync(
      path.resolve(__dirname, "../../src/app/api/admin/events/[id]/cover/route.ts"),
      "utf8"
    );
    expect(route).toContain("requireEventManageAccess");
    expect(route).toContain("rateLimitAsync");
    expect(route).toContain("isEventScopedBlobUrl");
    expect(route).toContain("Maksimal størrelse er 10 MB");
    expect(route).toContain("EVENT_COVER_UPLOADED");

    const token = readFileSync(
      path.resolve(
        __dirname,
        "../../src/app/api/admin/events/[id]/cover/upload-token/route.ts"
      ),
      "utf8"
    );
    expect(token).toContain("handleUpload");
    expect(token).toContain("requireEventManageAccess");
    expect(token).toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("door staff cannot manage events (RBAC helper)", () => {
    const access = readFileSync(
      path.resolve(__dirname, "../../src/lib/admin/org-access.ts"),
      "utf8"
    );
    expect(access).toContain("requireEventManageAccess");
    expect(access).toContain("canManageEvents");
    expect(access).toContain("Ingen tilgang til å redigere arrangementet");
  });
});

describe("cover upload route auth matrix (mocked)", () => {
  const eventId = "evt_cover_test";

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("SUPER_ADMIN can upload; door staff forbidden; invalid type rejected", async () => {
    const { AppError: AE } = await import("@/lib/api-error");
    const manage = vi.fn();
    vi.doMock("@/lib/admin/org-access", () => ({
      requireEventManageAccess: manage,
    }));
    vi.doMock("@/lib/db", () => ({
      prisma: {
        event: {
          update: vi.fn(async ({ data }: { data: { coverImageUrl: string } }) => ({
            id: eventId,
            slug: "x",
            coverImageUrl: data.coverImageUrl,
            updatedAt: new Date(),
            organizationId: "org1",
          })),
          count: vi.fn(async () => 0),
        },
        eventSeries: { count: vi.fn(async () => 0) },
      },
    }));
    vi.doMock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/security/rate-limit", () => ({
      clientIp: () => "127.0.0.1",
      rateLimitAsync: vi.fn(async () => ({ success: true, remaining: 10, resetAt: Date.now() })),
    }));
    const uploadEventCover = vi.fn(async () => ({
      url: `https://x.public.blob.vercel-storage.com/events/${eventId}/cover-1.jpg`,
      pathname: `events/${eventId}/cover-1.jpg`,
      contentType: "image/jpeg" as const,
    }));
    vi.doMock("@/lib/blob/cover-image", async () => {
      const actual = await vi.importActual<typeof import("@/lib/blob/cover-image")>(
        "@/lib/blob/cover-image"
      );
      return { ...actual, uploadEventCover, deleteBlobIfOurs: vi.fn(), requireBlobToken: () => "tok" };
    });

    manage.mockResolvedValue({
      user: { id: "sa", globalRole: "SUPER_ADMIN" },
      event: { id: eventId, organizationId: "org1", coverImageUrl: null, slug: "x" },
    });

    const { POST } = await import("@/app/api/admin/events/[id]/cover/route");
    const jpeg = jpegHeader(200);
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from(jpeg)], "cover.jpg", { type: "image/jpeg" })
    );
    const ok = await POST(new Request("http://localhost/api", { method: "POST", body: form }), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(ok.status).toBe(200);
    expect(uploadEventCover).toHaveBeenCalled();

    manage.mockRejectedValue(new AE("FORBIDDEN", "Ingen tilgang til å redigere arrangementet", 403));
    const denied = await POST(
      new Request("http://localhost/api", { method: "POST", body: form }),
      { params: Promise.resolve({ id: eventId }) }
    );
    expect(denied.status).toBe(403);

    manage.mockResolvedValue({
      user: { id: "admin", globalRole: "CUSTOMER" },
      event: { id: eventId, organizationId: "org1", coverImageUrl: null, slug: "x" },
    });
    const badForm = new FormData();
    badForm.append(
      "file",
      new File([Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])], "x.txt", { type: "text/plain" })
    );
    const bad = await POST(
      new Request("http://localhost/api", { method: "POST", body: badForm }),
      { params: Promise.resolve({ id: eventId }) }
    );
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/JPG|PNG|WebP|bilde/i);
  });
});
