/**
 * Coerce API/SDK/unknown errors into a safe Norwegian UI string.
 * Never returns "[object Object]" — classic JS pitfall when Error(object) or React-rendering objects.
 */

export const PAYMENT_ERROR_FALLBACK = "Noe gikk galt med betalingen. Prøv igjen.";
export const GENERIC_ERROR_FALLBACK = "Noe gikk galt. Prøv igjen.";

const OBJECT_OBJECT_RE = /^\[?\s*object\s+Object\s*\]?$/i;

function isUsableString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !OBJECT_OBJECT_RE.test(trimmed);
}

function pickNestedMessage(value: unknown, depth: number): string | null {
  if (depth <= 0 || value == null) return null;

  if (isUsableString(value)) return value.trim();

  if (value instanceof Error) {
    if (isUsableString(value.message)) return value.message.trim();
    return pickNestedMessage((value as Error & { cause?: unknown }).cause, depth - 1);
  }

  if (typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;

  // Standard Ticketly / Stripe-like envelopes
  if ("error" in obj) {
    const fromError = pickNestedMessage(obj.error, depth - 1);
    if (fromError) return fromError;
  }

  for (const key of ["message", "detail", "details", "title", "description", "msg"] as const) {
    const nested = obj[key];
    if (isUsableString(nested)) return nested.trim();
    const deeper = pickNestedMessage(nested, depth - 1);
    if (deeper) return deeper;
  }

  // Zod flatten: { formErrors: string[], fieldErrors: Record<string, string[]> }
  if (Array.isArray(obj.formErrors)) {
    const first = obj.formErrors.find((x) => isUsableString(x));
    if (first) return first.trim();
  }
  if (obj.fieldErrors && typeof obj.fieldErrors === "object") {
    for (const msgs of Object.values(obj.fieldErrors as Record<string, unknown>)) {
      if (Array.isArray(msgs)) {
        const first = msgs.find((x) => isUsableString(x));
        if (first) return first.trim();
      } else if (isUsableString(msgs)) {
        return msgs.trim();
      }
    }
  }

  return null;
}

/**
 * Extract a human-readable error string for UI (toast, alert, inline error).
 * Accepts thrown Errors, API bodies `{ error: { message } }`, Stripe-like shapes, or raw strings.
 */
export function toUserFacingError(
  err: unknown,
  fallback: string = GENERIC_ERROR_FALLBACK
): string {
  const extracted = pickNestedMessage(err, 6);
  if (extracted) return extracted;
  return fallback;
}

/** Convenience for payment/checkout flows. */
export function toPaymentUserFacingError(err: unknown): string {
  return toUserFacingError(err, PAYMENT_ERROR_FALLBACK);
}
