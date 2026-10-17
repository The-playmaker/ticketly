import bcrypt from "bcryptjs";
import { strongPasswordSchema } from "@ticketly/validation";

const BCRYPT_ROUNDS = 12;

export function validateStrongPassword(password: string): { ok: true } | { ok: false; error: string } {
  const parsed = strongPasswordSchema.safeParse(password);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ugyldig passord" };
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  const check = validateStrongPassword(password);
  if (!check.ok) throw new Error(check.error);
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/** Known weak demo patterns — never accept as production bootstrap passwords in readiness checks. */
export const WEAK_PASSWORD_PATTERNS = [
  /^password123$/i,
  /^password$/i,
  /^12345678/,
  /^admin123/i,
  /^ticketly$/i,
];

export function looksLikeWeakPassword(password: string): boolean {
  return WEAK_PASSWORD_PATTERNS.some((re) => re.test(password));
}
