/**
 * Redact ticket / order credentials from logs and structured telemetry.
 * Never log raw QR tokens, dynamic QR credentials, or order access tokens.
 */

const SENSITIVE_KEY =
  /^(secureToken|token|accessToken|tokenCipher|tokenHash|rawToken|authorization|cookie)$/i;

const TOKENISH =
  /(\/t\/verify\/)[A-Za-z0-9_-]{16,}/g;
const DQRISH = /(dqr\.v1\.)[A-Za-z0-9._-]{16,}/gi;
const QUERY_T = /([?&]t=)[A-Za-z0-9_-]{16,}/g;

export function redactSensitiveString(input: string): string {
  return input
    .replace(TOKENISH, "$1[redacted]")
    .replace(DQRISH, "$1[redacted]")
    .replace(QUERY_T, "$1[redacted]");
}

export function redactSensitiveValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return redactSensitiveString(value);
  if (Array.isArray(value)) return value.map((v) => redactSensitiveValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactSensitiveValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** Safe console.error wrapper for ticket-adjacent paths */
export function secureLogError(message: string, err?: unknown) {
  const detail =
    err instanceof Error
      ? redactSensitiveString(err.message)
      : redactSensitiveValue(err);
  console.error(message, detail);
}
