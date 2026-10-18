/**
 * Bounded retry for Stripe API calls (429 / 5xx).
 * Never logs secrets or response bodies that may contain PII.
 */

export type StripeRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStripeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    statusCode?: number;
    status?: number;
    type?: string;
    code?: string;
    raw?: { statusCode?: number };
  };
  const status = e.statusCode ?? e.status ?? e.raw?.statusCode;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500 && status < 600) return true;
  if (e.type === "StripeConnectionError" || e.type === "StripeAPIError") {
    if (status == null) return true;
  }
  if (e.code === "rate_limit") return true;
  return false;
}

export async function withStripeRetry<T>(
  fn: () => Promise<T>,
  opts: StripeRetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const maxDelayMs = opts.maxDelayMs ?? 4000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryableStripeError(err)) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 100);
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1) + jitter);
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Run async work over items with a fixed concurrency limit. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}
