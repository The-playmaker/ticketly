import {
  getNexiApiBaseUrl,
  getNexiEnvironment,
  getNexiSecretApiKey,
} from "./nexi-config";

export class NexiApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "NexiApiError";
  }
}

type NexiRequestOptions = {
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  /** Injected for tests */
  fetchImpl?: typeof fetch;
};

/**
 * Server-side Nexi Checkout Payment API client.
 * Authorization header uses the secret API key (no Bearer prefix).
 */
export async function nexiRequest<T>(options: NexiRequestOptions): Promise<T> {
  const base = getNexiApiBaseUrl(getNexiEnvironment());
  const secret = getNexiSecretApiKey();
  const fetchFn = options.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Authorization: secret,
    "Content-Type": "application/json",
    Accept: "application/json",
    CommercePlatformTag: "Ticketly",
  };
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey.slice(0, 64);
  }

  let response: Response;
  try {
    response = await fetchFn(`${base}${options.path}`, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (e) {
    throw new NexiApiError(
      `Nexi API network error: ${e instanceof Error ? e.message : "timeout/unreachable"}`,
      0
    );
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : `Nexi API ${response.status}`;
    throw new NexiApiError(msg, response.status, parsed);
  }

  return parsed as T;
}

export function sanitizeNexiLogPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const redact = ["pan", "cardNumber", "cvv", "cvc", "expiry", "Authorization", "authorization"];
  const walk = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      if (redact.some((r) => key.toLowerCase().includes(r.toLowerCase()))) {
        obj[key] = "[redacted]";
      } else if (obj[key] && typeof obj[key] === "object") {
        walk(obj[key] as Record<string, unknown>);
      }
    }
  };
  walk(clone);
  return clone;
}
