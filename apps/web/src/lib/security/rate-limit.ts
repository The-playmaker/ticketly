/**
 * Rate limit provider abstraction — Memory for single-node; swap for Redis in multi-instance.
 */

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number;
};

export interface RateLimitProvider {
  limit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> | RateLimitResult;
}

type Bucket = { timestamps: number[] };

export class MemoryRateLimitProvider implements RateLimitProvider {
  private buckets = new Map<string, Bucket>();

  limit(
    key: string,
    limit = Number(process.env.RATE_LIMIT_MAX ?? 60),
    windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
  ): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

    if (bucket.timestamps.length >= limit) {
      this.buckets.set(key, bucket);
      const oldest = bucket.timestamps[0] ?? now;
      return { success: false, remaining: 0, resetAt: oldest + windowMs };
    }

    bucket.timestamps.push(now);
    this.buckets.set(key, bucket);
    return {
      success: true,
      remaining: limit - bucket.timestamps.length,
      resetAt: now + windowMs,
    };
  }
}

/** TODO: RedisRateLimitProvider using INCR + PEXPIRE when REDIS_URL is set */
export class RedisRateLimitProvider implements RateLimitProvider {
  async limit(_key: string, _limit: number, _windowMs: number): Promise<RateLimitResult> {
    throw new Error("RedisRateLimitProvider not configured — set REDIS_URL and implement");
  }
}

let provider: RateLimitProvider = new MemoryRateLimitProvider();

export function getRateLimitProvider(): RateLimitProvider {
  return provider;
}

export function setRateLimitProvider(p: RateLimitProvider) {
  provider = p;
}

export function rateLimit(
  key: string,
  limit = Number(process.env.RATE_LIMIT_MAX ?? 60),
  windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
): RateLimitResult {
  const result = provider.limit(key, limit, windowMs);
  if (result instanceof Promise) {
    throw new Error("Async rate limiter requires await rateLimitAsync");
  }
  return result;
}

export async function rateLimitAsync(
  key: string,
  limit = Number(process.env.RATE_LIMIT_MAX ?? 60),
  windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
): Promise<RateLimitResult> {
  return provider.limit(key, limit, windowMs);
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
