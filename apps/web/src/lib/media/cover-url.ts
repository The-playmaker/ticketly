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
    const v =
      version instanceof Date
        ? String(version.getTime())
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
