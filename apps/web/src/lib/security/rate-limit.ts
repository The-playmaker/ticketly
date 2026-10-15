/**
 * Rate limit provider abstraction — Memory for single-node;
 * Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + TOKEN are set.
 * Never Vercel KV (sunset).
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

/**
 * Upstash Redis REST rate limiter (INCR + EXPIRE).
 * Financial inventory remains in PostgreSQL — Redis is only for counters/limits.
 */
export class UpstashRedisRateLimitProvider implements RateLimitProvider {
  constructor(
    private url: string,
    private token: string
  ) {}

  async limit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
    const pipeline = [
      ["INCR", redisKey],
      ["EXPIRE", redisKey, String(windowSec), "NX"],
      ["PTTL", redisKey],
    ];
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pipeline),
    });
    if (!res.ok) {
      // Fail open to memory-less allow with logging — prefer availability at checkout
      console.error("[rate-limit] upstash error", res.status);
      return { success: true, remaining: limit, resetAt: Date.now() + windowMs };
    }
    const data = (await res.json()) as { result: number }[];
    const count = Number(data[0]?.result ?? 1);
    const pttl = Number(data[2]?.result ?? windowMs);
    const resetAt = Date.now() + (pttl > 0 ? pttl : windowMs);
    if (count > limit) {
      return { success: false, remaining: 0, resetAt };
    }
    return { success: true, remaining: Math.max(0, limit - count), resetAt };
  }
}

function createDefaultProvider(): RateLimitProvider {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return new UpstashRedisRateLimitProvider(url, token);
  }
  return new MemoryRateLimitProvider();
}

let provider: RateLimitProvider = createDefaultProvider();

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
    // Sync call sites: fall back to memory for unexpected async provider
    return new MemoryRateLimitProvider().limit(key, limit, windowMs);
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
