import { NextResponse } from "next/server";
import { consentSchema } from "@ticketly/validation";
import { recordConsent } from "@ticketly/ticketing";
import { verifyMobileSession } from "@/app/api/mobile/auth/login/route";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const userId = await verifyMobileSession(req.headers.get("authorization"));
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 }
    );
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const parsed = consentSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Ugyldig" } },
      { status: 400 }
    );
  }

  await recordConsent({
    userId,
    email: user.email,
    purpose: parsed.data.purpose,
    version: parsed.data.version,
    granted: parsed.data.granted,
    source: "mobile_settings",
  });

  return NextResponse.json({ ok: true });
}
