import { timingSafeEqual } from "crypto";

/**
 * Constant-time string equality for secrets (CRON_SECRET, Nexi webhook auth, tokens).
 * Different lengths return false without throwing.
 */
export function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
      // Keep roughly constant work on length mismatch
      timingSafeEqual(ba, ba);
      return false;
    }
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Compare `Authorization: Bearer <secret>` using safeEqual. */
export function bearerMatches(authorization: string | null | undefined, secret: string): boolean {
  if (!authorization || !secret) return false;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  return safeEqual(authorization.slice(prefix.length), secret);
}
