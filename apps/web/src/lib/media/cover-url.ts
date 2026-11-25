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

/**
 * GIF covers may be animated. next/image's optimizer would only add a hop (and
 * re-encoding can drop frames), so render GIFs with `unoptimized`.
 */
export function isGifCover(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".gif");
  } catch {
    return /\.gif(\?|#|$)/i.test(url);
  }
}
