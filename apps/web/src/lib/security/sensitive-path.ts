/**
 * Paths that must never land in analytics / third-party referrers with credentials.
 */

const BLOCKED_PREFIXES = [
  "/orders/",
  "/my/tickets",
  "/t/verify/",
  "/t/dqr/",
  "/api/tickets/",
  "/checkout/payment",
];

export function isSensitiveTicketPath(path: string | undefined | null): boolean {
  if (!path) return false;
  const p = path.split("?")[0] ?? path;
  return BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix));
}

/** Strip query strings and collapse sensitive paths for analytics storage */
export function sanitizeAnalyticsPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const bare = path.split("?")[0] ?? path;
  if (isSensitiveTicketPath(bare)) {
    if (bare.startsWith("/orders/")) return "/orders/[redacted]";
    if (bare.startsWith("/t/verify/")) return "/t/verify/[redacted]";
    if (bare.startsWith("/t/dqr/")) return "/t/dqr/[redacted]";
    if (bare.startsWith("/api/tickets/")) return "/api/tickets/[redacted]";
    return "[redacted-ticket-path]";
  }
  return bare.slice(0, 500);
}

export function sanitizeAnalyticsReferrer(referrer: string | undefined): string | undefined {
  if (!referrer) return undefined;
  try {
    const u = new URL(referrer);
    if (isSensitiveTicketPath(u.pathname)) {
      return `${u.origin}${sanitizeAnalyticsPath(u.pathname)}`;
    }
    u.search = "";
    u.hash = "";
    return u.toString().slice(0, 500);
  } catch {
    return undefined;
  }
}
