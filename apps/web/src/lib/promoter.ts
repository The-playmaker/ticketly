/** Cookie / storage key for promoter referral attribution. */
export const PROMOTER_REF_COOKIE = "ticketly_ref";
export const PROMOTER_REF_STORAGE_KEY = "ticketly_ref";

/** Max age for referral cookie (7 days). */
export const PROMOTER_REF_MAX_AGE_SEC = 60 * 60 * 24 * 7;

/**
 * Public path for a promoter share link.
 * Example: `/events/oslo-night?ref=OLA20`
 */
export function buildPromoterTrackingPath(eventSlug: string, code: string): string {
  const slug = eventSlug.trim().replace(/^\/+|\/+$/g, "");
  const normalized = code.trim().toUpperCase();
  return `/events/${encodeURIComponent(slug)}?ref=${encodeURIComponent(normalized)}`;
}

/** Absolute share URL when base is known. */
export function buildPromoterTrackingUrl(
  baseUrl: string,
  eventSlug: string,
  code: string
): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${buildPromoterTrackingPath(eventSlug, code)}`;
}

/** Short redirect path `/p/CODE` → resolves to event+ref when promo has eventId. */
export function buildPromoterShortPath(code: string): string {
  return `/p/${encodeURIComponent(code.trim().toUpperCase())}`;
}

export function normalizePromoterCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Read referral code from a URLSearchParams (`ref` or `promo`). */
export function readRefFromSearchParams(params: URLSearchParams): string | null {
  const raw = params.get("ref") ?? params.get("promo") ?? params.get("promoCode");
  if (!raw) return null;
  const code = normalizePromoterCode(raw);
  return code.length >= 2 ? code : null;
}

/** Client-safe cookie write (document.cookie). */
export function setPromoterRefCookie(code: string, maxAgeSec = PROMOTER_REF_MAX_AGE_SEC) {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(normalizePromoterCode(code));
  document.cookie = `${PROMOTER_REF_COOKIE}=${value}; path=/; max-age=${maxAgeSec}; SameSite=Lax`;
  try {
    sessionStorage.setItem(PROMOTER_REF_STORAGE_KEY, normalizePromoterCode(code));
  } catch {
    /* ignore */
  }
}

/** Read referral from cookie / sessionStorage (browser only). */
export function readPromoterRefClient(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromStorage = sessionStorage.getItem(PROMOTER_REF_STORAGE_KEY);
    if (fromStorage && fromStorage.length >= 2) return normalizePromoterCode(fromStorage);
  } catch {
    /* ignore */
  }
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${PROMOTER_REF_COOKIE}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(PROMOTER_REF_COOKIE.length + 1));
  const code = normalizePromoterCode(value);
  return code.length >= 2 ? code : null;
}
