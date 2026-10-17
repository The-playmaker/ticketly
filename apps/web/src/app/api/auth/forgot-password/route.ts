import { NextResponse } from "next/server";
import { forgotPasswordSchema } from "@ticketly/validation";
import { UserAdminService } from "@/services/user-admin-service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

const GENERIC =
  "Hvis kontoen finnes, har vi sendt instruksjoner.";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`forgot-password:${ip}`, 5);
  if (!rl.success) {
    return NextResponse.json({ message: GENERIC });
  }

  try {
    const body = await req.json();
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: GENERIC });
    }

    await UserAdminService.sendPasswordReset({
      email: parsed.data.email,
      ipAddress: ip,
    });
  } catch (e) {
    console.error("[forgot-password]", e);
  }

  return NextResponse.json({ message: GENERIC });
}
