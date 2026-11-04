/**
 * Rate limit provider abstraction — Memory for single-node;
 * Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + TOKEN are set.
 * Never Vercel KV (sunset).
 *
 * Always use `rateLimitAsync` — sync `rateLimit` is removed because Redis
 * providers return Promises and a sync wrapper would silently ignore them.
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

const DEFAULT_MAX_KEYS = 10_000;

export class MemoryRateLimitProvider implements RateLimitProvider {
  private buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;

  constructor(opts?: { maxKeys?: number }) {
    this.maxKeys = opts?.maxKeys ?? Number(process.env.RATE_LIMIT_MAX_KEYS ?? DEFAULT_MAX_KEYS);
  }

  /**
   * Drop empty/expired buckets; if still over maxKeys, evict oldest by earliest
   * timestamp (optionally keep `retainKey` so a just-incremented key survives).
   */
  private prune(now: number, windowMs: number, retainKey?: string) {
    for (const [k, b] of this.buckets) {
      b.timestamps = b.timestamps.filter((t) => now - t < windowMs);
      if (b.timestamps.length === 0) this.buckets.delete(k);
      else this.buckets.set(k, b);
    }
    if (this.buckets.size <= this.maxKeys) return;
    const ranked = [...this.buckets.entries()]
      .filter(([k]) => k !== retainKey)
      .sort((a, b) => (a[1].timestamps[0] ?? 0) - (b[1].timestamps[0] ?? 0));
    let overflow = this.buckets.size - this.maxKeys;
    for (const [k] of ranked) {
      if (overflow <= 0) break;
      this.buckets.delete(k);
      overflow -= 1;
    }
  }

  limit(
    key: string,
    limit = Number(process.env.RATE_LIMIT_MAX ?? 60),
    windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
  ): RateLimitResult {
    const now = Date.now();
    this.prune(now, windowMs);

    const bucket = this.buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

    if (bucket.timestamps.length >= limit) {
      this.buckets.set(key, bucket);
      const oldest = bucket.timestamps[0] ?? now;
      return { success: false, remaining: 0, resetAt: oldest + windowMs };
    }

    bucket.timestamps.push(now);
    this.buckets.set(key, bucket);
    // Enforce max after insert — keep the key we just updated
    if (this.buckets.size > this.maxKeys) {
      this.prune(now, windowMs, key);
    }
    return {
      success: true,
      remaining: limit - bucket.timestamps.length,
      resetAt: now + windowMs,
    };
  }

  /** Test helper — current number of tracked keys. */
  size(): number {
    return this.buckets.size;
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

/**
 * @deprecated Use `rateLimitAsync` — sync wrapper cannot await Redis providers.
 * Kept temporarily as a thin alias that throws if the provider returns a Promise
 * without being awaited (should not be called from new code).
 */
export function rateLimit(
  _key: string,
  _limit = Number(process.env.RATE_LIMIT_MAX ?? 60),
  _windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
): RateLimitResult {
  throw new Error(
    "rateLimit() sync API removed — use await rateLimitAsync() so Redis providers are honoured"
  );
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
