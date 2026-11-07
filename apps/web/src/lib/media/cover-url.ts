/**
 * Cache-bust cover URLs after replacement so CDN/browser don't show stale images.
 * Preserves existing query string; uses event.updatedAt (or explicit version).
 */
export function withCoverCacheBust(
  url: string | null | undefined,
  version?: string | number | Date | null
): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // unstable_cache JSON-serializes Dates to ISO strings; normalize so cache
    // hits and misses produce the same URL (avoids re-downloading the cover).
    const isoMs =
      typeof version === "string" && /^\d{4}-\d{2}-\d{2}T/.test(version)
        ? Date.parse(version)
        : NaN;
    const v =
      version instanceof Date
        ? String(version.getTime())
        : Number.isFinite(isoMs)
          ? String(isoMs)
          : version != null && String(version).length > 0
            ? String(version)
            : null;
    if (v) u.searchParams.set("v", v);
    return u.toString();
  } catch {
    if (!version) return url;
    const v =
      version instanceof Date ? String(version.getTime()) : String(version);
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${encodeURIComponent(v)}`;
  }
}
