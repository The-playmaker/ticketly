import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";

export type AuthTokenPurpose = "PASSWORD_RESET" | "INVITE_PASSWORD_SETUP";

const DEFAULT_TTL_MS = {
  PASSWORD_RESET: 60 * 60 * 1000, // 1h
  INVITE_PASSWORD_SETUP: 7 * 24 * 60 * 60 * 1000, // 7d
} as const;

export function generateRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createAuthActionToken(input: {
  email: string;
  purpose: AuthTokenPurpose;
  userId?: string | null;
  ttlMs?: number;
}): Promise<{ rawToken: string; expiresAt: Date; id: string }> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(
    Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS[input.purpose])
  );

  // Invalidate prior unused tokens for same email+purpose
  await prisma.authActionToken.updateMany({
    where: {
      email: input.email.toLowerCase(),
      purpose: input.purpose,
      usedAt: null,
    },
    data: { usedAt: new Date() },
  });

  const row = await prisma.authActionToken.create({
    data: {
      email: input.email.toLowerCase(),
      purpose: input.purpose,
      userId: input.userId ?? undefined,
      tokenHash,
      expiresAt,
    },
  });

  return { rawToken, expiresAt, id: row.id };
}

export async function consumeAuthActionToken(input: {
  rawToken: string;
  purpose: AuthTokenPurpose;
}): Promise<{ id: string; email: string; userId: string | null } | null> {
  const tokenHash = hashToken(input.rawToken);
  const row = await prisma.authActionToken.findUnique({ where: { tokenHash } });
  if (!row) return null;
  if (row.purpose !== input.purpose) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  const updated = await prisma.authActionToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (updated.count === 0) return null;

  return { id: row.id, email: row.email, userId: row.userId };
}

export async function peekAuthActionToken(input: {
  rawToken: string;
  purpose?: AuthTokenPurpose;
}): Promise<{ email: string; purpose: string; expiresAt: Date; used: boolean } | null> {
  const tokenHash = hashToken(input.rawToken);
  const row = await prisma.authActionToken.findUnique({ where: { tokenHash } });
  if (!row) return null;
  if (input.purpose && row.purpose !== input.purpose) return null;
  return {
    email: row.email,
    purpose: row.purpose,
    expiresAt: row.expiresAt,
    used: !!row.usedAt || row.expiresAt.getTime() < Date.now(),
  };
}
