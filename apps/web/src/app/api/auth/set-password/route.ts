import { NextResponse } from "next/server";
import { setPasswordSchema } from "@ticketly/validation";
import { z } from "zod";
import { hashPassword, validateStrongPassword } from "@/lib/auth/password";
import { consumeAuthActionToken, peekAuthActionToken } from "@/lib/auth/action-tokens";
import { UserAdminService } from "@/services/user-admin-service";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { jsonError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = setPasswordSchema.extend({
  inviteToken: z.string().min(16).optional(),
  name: z.string().max(120).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const peek = await peekAuthActionToken({ rawToken: token });
  if (!peek || peek.used) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }
  return NextResponse.json({
    valid: true,
    email: peek.email,
    purpose: peek.purpose,
    expiresAt: peek.expiresAt,
  });
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(`set-password:${ip}`, 10);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig data" }, { status: 400 });
    }

    const pwd = validateStrongPassword(parsed.data.password);
    if (!pwd.ok) {
      return NextResponse.json({ error: pwd.error }, { status: 400 });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    if (parsed.data.inviteToken) {
      const user = await UserAdminService.acceptInviteAndSetPassword({
        inviteToken: parsed.data.inviteToken,
        setupToken: parsed.data.token,
        passwordHash,
        name: parsed.data.name,
      });
      return NextResponse.json({ ok: true, email: user.email });
    }

    const consumed = await consumeAuthActionToken({
      rawToken: parsed.data.token,
      purpose: "PASSWORD_RESET",
    });
    if (!consumed) {
      // Also allow INVITE_PASSWORD_SETUP without invite token (platform invite)
      const setup = await consumeAuthActionToken({
        rawToken: parsed.data.token,
        purpose: "INVITE_PASSWORD_SETUP",
      });
      if (!setup) {
        return NextResponse.json(
          { error: "Lenken er ugyldig eller utløpt" },
          { status: 400 }
        );
      }
      const user = await prisma.user.update({
        where: { email: setup.email },
        data: {
          passwordHash,
          isActive: true,
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
        },
      });
      await writeAuditLog({
        actorId: user.id,
        action: "PASSWORD_SET",
        entityType: "User",
        entityId: user.id,
        metadata: { purpose: "INVITE_PASSWORD_SETUP" },
        ipAddress: ip,
      });
      return NextResponse.json({ ok: true, email: user.email });
    }

    const user = await prisma.user.update({
      where: { email: consumed.email },
      data: { passwordHash, isActive: true },
    });
    await writeAuditLog({
      actorId: user.id,
      action: "PASSWORD_RESET_COMPLETED",
      entityType: "User",
      entityId: user.id,
      ipAddress: ip,
    });
    return NextResponse.json({ ok: true, email: user.email });
  } catch (e) {
    return jsonError(e);
  }
}
