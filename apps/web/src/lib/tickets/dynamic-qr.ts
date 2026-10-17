import { createHmac, timingSafeEqual } from "crypto";
import { hashTicketToken } from "@/lib/tickets/token";

/**
 * Dynamic QR credentials (opt-in foundation).
 *
 * CRITICAL PRODUCTION RULES:
 * - STATIC_QR remains the default. DYNAMIC_QR is OFF unless Event.qrMode=DYNAMIC_QR
 *   AND process.env.ENABLE_DYNAMIC_QR === "true".
 * - Payload NEVER embeds the long-lived ticket secret.
 * - Minting MUST NOT accept a copied static QR token as proof of ownership
 *   (no public "refresh from QR" API). Holder session / order access token only.
 * - Screenshots of a live dynamic QR can still be shared until expiry/check-in —
 *   dynamic QR does NOT completely prevent screenshot sharing.
 * - Offline scanners MUST reject dynamic payloads (no insecure static fallback).
 */

export const DYNAMIC_QR_PREFIX = "dqr.v1";

export type DynamicQrClaims = {
  /** Ticket publicId */
  pid: string;
  /** Event id */
  eid: string;
  /** Expiry unix seconds (server clock) */
  exp: number;
  /** Unique nonce */
  n: string;
};

function dynamicQrMasterSecret(): Buffer {
  const secret = process.env.TICKET_TOKEN_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("TICKET_TOKEN_SECRET or AUTH_SECRET required for dynamic QR");
  }
  return Buffer.from(secret, "utf8");
}

/** Per-ticket MAC key derived from tokenHash — rotates on transfer. */
export function dynamicQrMacKey(tokenHash: string): Buffer {
  return createHmac("sha256", dynamicQrMasterSecret())
    .update(`dqr-mac:${tokenHash}`)
    .digest();
}

export function isDynamicQrFeatureEnabled(): boolean {
  return process.env.ENABLE_DYNAMIC_QR === "true";
}

export function clampDynamicQrTtlSeconds(ttl: number): number {
  if (!Number.isFinite(ttl)) return 30;
  return Math.min(120, Math.max(15, Math.floor(ttl)));
}

export function dynamicQrClockSkewSeconds(): number {
  const raw = Number(process.env.DYNAMIC_QR_CLOCK_SKEW_SECONDS ?? "30");
  if (!Number.isFinite(raw)) return 30;
  return Math.min(120, Math.max(0, Math.floor(raw)));
}

export function looksLikeDynamicQrCredential(raw: string): boolean {
  const s = raw.trim();
  return s.startsWith(`${DYNAMIC_QR_PREFIX}.`) || s.includes(`/t/dqr/`);
}

/** Extract credential body from URL or raw payload */
export function extractDynamicQrCredential(raw: string): string {
  const trimmed = raw.trim();
  const urlMatch = trimmed.match(/\/t\/dqr\/([^/?#]+)/);
  if (urlMatch?.[1]) return decodeURIComponent(urlMatch[1]);
  return trimmed;
}

function canonicalClaims(claims: DynamicQrClaims): string {
  return `${claims.pid}|${claims.eid}|${claims.exp}|${claims.n}`;
}

export function signDynamicQrCredential(
  claims: DynamicQrClaims,
  tokenHash: string
): string {
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", dynamicQrMacKey(tokenHash))
    .update(canonicalClaims(claims))
    .digest("base64url");
  return `${DYNAMIC_QR_PREFIX}.${body}.${mac}`;
}

export type DynamicQrParseResult =
  | { ok: true; claims: DynamicQrClaims; mac: string }
  | { ok: false; reason: "MALFORMED" | "EXPIRED" | "NOT_YET_VALID" };

export function parseDynamicQrCredential(
  credential: string,
  nowMs = Date.now()
): DynamicQrParseResult {
  const raw = extractDynamicQrCredential(credential);
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "dqr" || parts[1] !== "v1") {
    return { ok: false, reason: "MALFORMED" };
  }
  const body = parts[2]!;
  const mac = parts[3]!;
  let claims: DynamicQrClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DynamicQrClaims;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (
    typeof claims.pid !== "string" ||
    typeof claims.eid !== "string" ||
    typeof claims.exp !== "number" ||
    typeof claims.n !== "string" ||
    !claims.pid ||
    !claims.eid ||
    !claims.n
  ) {
    return { ok: false, reason: "MALFORMED" };
  }

  const skew = dynamicQrClockSkewSeconds();
  const nowSec = Math.floor(nowMs / 1000);
  if (claims.exp + skew < nowSec) {
    return { ok: false, reason: "EXPIRED" };
  }
  // Reject credentials minted too far in the future (clock skew allowance)
  const maxFuture = nowSec + skew + 120;
  if (claims.exp > maxFuture) {
    return { ok: false, reason: "NOT_YET_VALID" };
  }

  return { ok: true, claims, mac };
}

export function verifyDynamicQrMac(
  claims: DynamicQrClaims,
  mac: string,
  tokenHash: string
): boolean {
  const expected = createHmac("sha256", dynamicQrMacKey(tokenHash))
    .update(canonicalClaims(claims))
    .digest("base64url");
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Build displayable QR value (URL form preferred for scanners). */
export function buildDynamicQrPayload(credential: string, baseUrl?: string): string {
  const base =
    baseUrl ??
    process.env.TICKET_VERIFY_BASE_URL ??
    process.env.APP_URL ??
    "http://localhost:3456";
  return `${base.replace(/\/$/, "")}/t/dqr/${encodeURIComponent(credential)}`;
}

/** Test helper: derive tokenHash the same way issuance does. */
export function hashForDynamicQrTests(rawToken: string): string {
  return hashTicketToken(rawToken);
}
