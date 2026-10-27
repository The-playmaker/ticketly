import { z } from "zod";

/** Norwegian messages used across checkout, admin, and invites. */
export const EMAIL_MESSAGES = {
  invalid: "Ugyldig e-postadresse",
  mismatch: "E-postene er ikke like",
  required: "E-post er påkrevd",
} as const;

/**
 * Domains we typo-check against (NO + common international inbox providers).
 * Soft suggestions only — never block uncommon legitimate domains.
 */
export const COMMON_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.no",
  "outlook.com",
  "outlook.no",
  "live.com",
  "live.no",
  "msn.com",
  "yahoo.com",
  "yahoo.no",
  "icloud.com",
  "me.com",
  "mac.com",
  "online.no",
  "online.mail.no",
  "start.no",
  "tele.no",
  "getmail.no",
  "broadpark.no",
  "c2i.net",
  "lyse.net",
  "ntebb.no",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
] as const;

/** Very common mistypes → intended domain (checked before distance). */
const DOMAIN_TYPO_MAP: Record<string, string> = {
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.om": "gmail.com",
  "hotmal.com": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotamil.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "htomail.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "outlook.con": "outlook.com",
  "outllok.com": "outlook.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "iclod.com": "icloud.com",
  "icloud.con": "icloud.com",
  "icoud.com": "icloud.com",
  "live.con": "live.com",
  "online.con": "online.no",
  "onlin.no": "online.no",
};

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Split local@domain; returns null if shape is unusable. */
export function splitEmail(value: string): { local: string; domain: string } | null {
  const normalized = normalizeEmail(value);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!local || !domain || local.includes(" ") || domain.includes(" ")) return null;
  return { local, domain };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/**
 * Soft typo suggestion for the domain part.
 * Returns a full corrected address, or null when no confident match.
 */
export function suggestEmailTypo(value: string): string | null {
  const parts = splitEmail(value);
  if (!parts) return null;

  const mapped = DOMAIN_TYPO_MAP[parts.domain];
  if (mapped && mapped !== parts.domain) {
    return `${parts.local}@${mapped}`;
  }

  // Already a known good domain — no suggestion.
  if ((COMMON_EMAIL_DOMAINS as readonly string[]).includes(parts.domain)) {
    return null;
  }

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const d = levenshtein(parts.domain, candidate);
    // Allow 1 edit for short domains, 2 for longer (e.g. hotmail.com).
    const max = candidate.length <= 8 ? 1 : 2;
    if (d > 0 && d <= max && d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }

  if (!best) return null;
  return `${parts.local}@${best}`;
}

/**
 * Authoritative email field: trim + lowercase, then format-check.
 * Use on every write path (checkout, admin correction, invites).
 */
export const emailSchema = z
  .string({ error: EMAIL_MESSAGES.required })
  .trim()
  .toLowerCase()
  .min(3, EMAIL_MESSAGES.invalid)
  .max(254, EMAIL_MESSAGES.invalid)
  .email(EMAIL_MESSAGES.invalid)
  .refine((v) => {
    // Reject consecutive dots and empty labels that slip past some clients.
    const parts = splitEmail(v);
    if (!parts) return false;
    if (parts.local.includes("..") || parts.domain.includes("..")) return false;
    if (parts.local.startsWith(".") || parts.local.endsWith(".")) return false;
    if (parts.domain.startsWith(".") || parts.domain.endsWith(".")) return false;
    if (!parts.domain.includes(".")) return false;
    return true;
  }, EMAIL_MESSAGES.invalid);

export type EmailSuggestion = {
  original: string;
  suggested: string;
  message: string;
};

export function emailTypoHint(value: string): EmailSuggestion | null {
  const suggested = suggestEmailTypo(value);
  if (!suggested) return null;
  const original = normalizeEmail(value);
  if (suggested === original) return null;
  return {
    original,
    suggested,
    message: `Mente du ${suggested}?`,
  };
}
