import { randomBytes } from "crypto";

/** Cryptographically secure ticket token (not guessable) */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Human-readable public ticket id e.g. TKT-A7K2M9 */
export function generatePublicTicketId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const buf = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[buf[i]! % alphabet.length];
  }
  return `TKT-${code}`;
}

/** QR payload — verify URL with secure token only (no PII) */
export function buildQrPayload(token: string, baseUrl?: string): string {
  const base = baseUrl ?? process.env.TICKET_VERIFY_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3456";
  return `${base.replace(/\/$/, "")}/t/verify/${token}`;
}
