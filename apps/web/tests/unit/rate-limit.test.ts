import { describe, expect, it, beforeEach } from "vitest";
import {
  MemoryRateLimitProvider,
  rateLimitAsync,
  setRateLimitProvider,
  type RateLimitProvider,
  type RateLimitResult,
} from "@/lib/security/rate-limit";

describe("rateLimitAsync with Promise providers", () => {
  beforeEach(() => {
    setRateLimitProvider(new MemoryRateLimitProvider());
  });

  it("honours async (Promise-returning) providers — N+1th call fails", async () => {
    const limit = 3;
    const windowMs = 60_000;
    let count = 0;

    const asyncProvider: RateLimitProvider = {
      async limit(_key, max): Promise<RateLimitResult> {
        count += 1;
        if (count > max) {
          return { success: false, remaining: 0, resetAt: Date.now() + windowMs };
        }
        return {
          success: true,
          remaining: max - count,
          resetAt: Date.now() + windowMs,
        };
      },
    };

    setRateLimitProvider(asyncProvider);

    for (let i = 0; i < limit; i++) {
      const r = await rateLimitAsync("test-key", limit, windowMs);
      expect(r.success).toBe(true);
    }
    const blocked = await rateLimitAsync("test-key", limit, windowMs);
    expect(blocked.success).toBe(false);
    expect(count).toBe(limit + 1);
  });

  it("MemoryRateLimitProvider expires old timestamps and caps keys", async () => {
    const mem = new MemoryRateLimitProvider({ maxKeys: 3 });
    setRateLimitProvider(mem);

    const windowMs = 50;
    await rateLimitAsync("a", 10, windowMs);
    await rateLimitAsync("b", 10, windowMs);
    await rateLimitAsync("c", 10, windowMs);
    expect(mem.size()).toBe(3);

    await rateLimitAsync("d", 10, windowMs);
    expect(mem.size()).toBeLessThanOrEqual(3);

    await new Promise((r) => setTimeout(r, windowMs + 20));
    // After expiry, prune on next call removes stale keys
    await rateLimitAsync("fresh", 10, windowMs);
    expect(mem.size()).toBeLessThanOrEqual(3);
    expect(mem.size()).toBeGreaterThanOrEqual(1);
  });

  it("MemoryRateLimitProvider blocks after limit within window", async () => {
    setRateLimitProvider(new MemoryRateLimitProvider());
    const limit = 2;
    expect((await rateLimitAsync("ip:1", limit, 60_000)).success).toBe(true);
    expect((await rateLimitAsync("ip:1", limit, 60_000)).success).toBe(true);
    expect((await rateLimitAsync("ip:1", limit, 60_000)).success).toBe(false);
  });
});
