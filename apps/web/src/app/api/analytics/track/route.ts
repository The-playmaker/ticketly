import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import {
  isSensitiveTicketPath,
  sanitizeAnalyticsPath,
  sanitizeAnalyticsReferrer,
} from "@/lib/security/sensitive-path";

const schema = z.object({
  type: z.enum([
    "PAGE_VIEW",
    "TICKET_SELECTION",
    "CHECKOUT_STARTED",
    "PAYMENT_INITIATED",
    "PAYMENT_SUCCESS",
    "PAYMENT_FAILED",
    "RESERVATION_EXPIRED",
  ]),
  eventId: z.string().optional(),
  organizationId: z.string().optional(),
  sessionId: z.string().min(8).max(128).optional(),
  orderId: z.string().optional(),
  path: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  utmTerm: z.string().max(100).optional(),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`analytics:${ip}`, 120);
  if (!rl.success) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  try {
    const body = schema.parse(await req.json());
    // Never store ticket / order-access URLs (credentials in query) in analytics
    if (isSensitiveTicketPath(body.path)) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    await prisma.analyticsEvent.create({
      data: {
        type: body.type,
        eventId: body.eventId,
        organizationId: body.organizationId,
        sessionId: body.sessionId,
        orderId: body.orderId,
        path: sanitizeAnalyticsPath(body.path),
        referrer: sanitizeAnalyticsReferrer(body.referrer),
        utmSource: body.utmSource,
        utmMedium: body.utmMedium,
        utmCampaign: body.utmCampaign,
        utmContent: body.utmContent,
        utmTerm: body.utmTerm,
      },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
