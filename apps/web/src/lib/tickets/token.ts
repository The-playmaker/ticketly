import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

export function hashTicketToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function encryptionKey(): Buffer {
  const secret = process.env.TICKET_TOKEN_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("TICKET_TOKEN_SECRET or AUTH_SECRET required");
  }
  return createHash("sha256").update(`ticket-token:${secret}`).digest();
}

export function encryptTicketToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptTicketToken(cipherText: string): string {
  const buf = Buffer.from(cipherText, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function generatePublicTicketId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const buf = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[buf[i]! % alphabet.length];
  }
  return `TKT-${code}`;
}

export function generateOrderAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function buildQrPayload(token: string, baseUrl?: string): string {
  const base =
    baseUrl ??
    process.env.TICKET_VERIFY_BASE_URL ??
    process.env.APP_URL ??
    "http://localhost:3456";
  return `${base.replace(/\/$/, "")}/t/verify/${token}`;
}

/** Resolve displayable raw QR token from ticket row */
export function resolveRawTicketToken(ticket: {
  tokenCipher?: string | null;
  secureToken?: string | null;
}): string | null {
  if (ticket.tokenCipher) {
    try {
      return decryptTicketToken(ticket.tokenCipher);
    } catch {
      return null;
    }
  }
  return ticket.secureToken ?? null;
}
