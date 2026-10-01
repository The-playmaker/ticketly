import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { loginSchema } from "@ticketly/validation";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

function signMobileToken(userId: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev";
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 7 * 86400_000 })).toString(
    "base64url"
  );
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyMobileToken(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const secret = process.env.AUTH_SECRET ?? "dev";
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    sub: string;
    exp: number;
  };
  if (data.exp < Date.now()) return null;
  return data.sub;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`mobile-login:${ip}`, 20);
  if (!rl.success) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  const parsed = loginSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: {
      memberships: {
        where: { isActive: true },
        select: { organizationId: true, role: true, canRefund: true, isActive: true },
      },
    },
  });
  if (!user?.passwordHash || !user.isActive) {
    return NextResponse.json({ error: "Feil e-post eller passord" }, { status: 401 });
  }
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "Feil e-post eller passord" }, { status: 401 });

  return NextResponse.json({
    token: signMobileToken(user.id),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      globalRole: user.globalRole,
      memberships: user.memberships,
    },
  });
}
