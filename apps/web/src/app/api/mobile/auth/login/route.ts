import { NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { loginSchema } from "@ticketly/validation";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { jsonError, AppError } from "@/lib/api-error";

const SESSION_TTL_MS = 7 * 86400_000;

function signMobileToken(userId: string, jti: string, exp: number): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new AppError("AUTH_MISCONFIGURED", "AUTH_SECRET not configured", 500);
  }
  const payload = Buffer.from(JSON.stringify({ sub: userId, jti, exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Sync signature check only — prefer verifyMobileSession for revocation. */
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
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      sub: string;
      exp: number;
      jti?: string;
    };
    if (data.exp < Date.now()) return null;
    return data.sub;
  } catch {
    return null;
  }
}

/** Full session validation including DB revocation + user active. */
export async function verifyMobileSession(header: string | null): Promise<string | null> {
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
  let data: { sub: string; exp: number; jti?: string };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      sub: string;
      exp: number;
      jti?: string;
    };
  } catch {
    return null;
  }
  if (data.exp < Date.now()) return null;

  // Legacy tokens without jti are rejected after MobileSession rollout
  if (!data.jti) return null;

  const session = await prisma.mobileSession.findUnique({ where: { jti: data.jti } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.userId !== data.sub) return null;

  const user = await prisma.user.findUnique({ where: { id: data.sub } });
  if (!user?.isActive) return null;

  return data.sub;
}

export async function revokeMobileSession(header: string | null): Promise<boolean> {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  const [payload] = token.split(".");
  if (!payload) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { jti?: string };
    if (!data.jti) return false;
    await prisma.mobileSession.updateMany({
      where: { jti: data.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`mobile-login:${ip}`, 20);
  if (!rl.success) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "For mange forsøk" } },
      { status: 429 }
    );
  }

  try {
    const parsed = loginSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Ugyldig data" } },
        { status: 400 }
      );
    }

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
      await writeAuditLog({
        action: "LOGIN_FAILURE",
        entityType: "User",
        entityId: parsed.data.email.toLowerCase(),
        metadata: { ip, source: "mobile" },
      });
      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "Feil e-post eller passord" } },
        { status: 401 }
      );
    }
    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) {
      await writeAuditLog({
        actorId: user.id,
        action: "LOGIN_FAILURE",
        entityType: "User",
        entityId: user.id,
        metadata: { ip, source: "mobile" },
      });
      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "Feil e-post eller passord" } },
        { status: 401 }
      );
    }

    const jti = randomBytes(16).toString("base64url");
    const exp = Date.now() + SESSION_TTL_MS;
    // Session create only — do not touch User.lastActiveAt on login (auth hot
    // path must stay free of activity UPDATEs that contend under concurrency).
    await prisma.mobileSession.create({
      data: {
        jti,
        userId: user.id,
        expiresAt: new Date(exp),
        userAgent: req.headers.get("user-agent")?.slice(0, 200),
      },
    });

    return NextResponse.json({
      token: signMobileToken(user.id, jti, exp),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        globalRole: user.globalRole,
        memberships: user.memberships,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
