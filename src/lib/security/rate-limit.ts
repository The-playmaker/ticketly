/**
 * In-memory sliding-window rate limiter.
 * Suitable for single-instance / Docker Compose. Swap for Redis in multi-instance prod.
 */

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number;
};

export function rateLimit(
  key: string,
  limit = Number(process.env.RATE_LIMIT_MAX ?? 60),
  windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.timestamps[0] ?? now;
    return { success: false, remaining: 0, resetAt: oldest + windowMs };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return {
    success: true,
    remaining: limit - bucket.timestamps.length,
    resetAt: now + windowMs,
  };
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
