import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildPromoterTrackingPath, normalizePromoterCode } from "@/lib/promoter";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Short promoter link: `/p/OLA20` → `/events/{slug}?ref=OLA20` when the code is
 * bound to an event. Org-wide codes without eventId fall back to home with ref.
 * Missing codes still redirect home — never error hard for share links.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { code: raw } = await ctx.params;
  const code = normalizePromoterCode(decodeURIComponent(raw ?? ""));
  if (!code || code.length < 2) {
    return NextResponse.redirect(new URL("/", _req.url));
  }

  const promo = await prisma.promoCode.findFirst({
    where: {
      code: { equals: code, mode: "insensitive" },
      isActive: true,
    },
    include: {
      event: { select: { slug: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (promo?.event?.slug) {
    const path = buildPromoterTrackingPath(promo.event.slug, promo.code);
    return NextResponse.redirect(new URL(path, _req.url));
  }

  // Org-wide or unknown: land on homepage with ref so cookie can still be set
  // if a CapturePromoterRef is present on subsequent event navigation.
  const fallback = new URL("/", _req.url);
  fallback.searchParams.set("ref", code);
  return NextResponse.redirect(fallback);
}
