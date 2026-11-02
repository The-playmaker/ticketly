import { PaymentProviderType } from "@prisma/client";
import { NexiApiError } from "./nexi-client";
import { nexiConfigHealth } from "./nexi-config";
import { stripeConfigHealth } from "./stripe-provider";
import { resolvePaymentProviderType } from "./resolve-provider";

/**
 * Controlled create-time failover: Nets Easy (Nexi) primary → Stripe backup.
 *
 * Rules (product):
 * - Fail over only when the primary is definitively unavailable BEFORE a payment
 *   object is created (config / auth), never mid-payment or on unknown/pending.
 * - Network timeouts and 5xx are UNKNOWN — do not auto-switch.
 * - Backup must be explicitly enabled via PAYMENT_BACKUP_PROVIDER.
 */

export type FailoverClass = "definitive_unavailable" | "unknown_or_pending" | "client_error";

export function resolveBackupProviderType(
  primary: PaymentProviderType = resolvePaymentProviderType()
): PaymentProviderType | null {
  const raw = (process.env.PAYMENT_BACKUP_PROVIDER ?? "").toLowerCase().trim();
  if (!raw || raw === "none" || raw === "off" || raw === "false") {
    // Convenience alias: PAYMENT_STRIPE_BACKUP=true with Nexi/Nets primary
    if (
      process.env.PAYMENT_STRIPE_BACKUP === "true" &&
      (primary === PaymentProviderType.NEXI || primary === PaymentProviderType.NETS)
    ) {
      return PaymentProviderType.STRIPE;
    }
    return null;
  }

  let backup: PaymentProviderType;
  switch (raw) {
    case "stripe":
      backup = PaymentProviderType.STRIPE;
      break;
    case "nexi":
    case "nets":
    case "nets-easy":
    case "nexi-checkout":
      backup = PaymentProviderType.NEXI;
      break;
    default:
      return null;
  }

  if (backup === primary) return null;
  // Only Nexi ↔ Stripe create-time backup is supported
  return backup;
}

export function isBackupConfigured(backup: PaymentProviderType): boolean {
  if (backup === PaymentProviderType.STRIPE) {
    return stripeConfigHealth().status === "operational";
  }
  if (backup === PaymentProviderType.NEXI || backup === PaymentProviderType.NETS) {
    return nexiConfigHealth().status === "operational";
  }
  return false;
}

/**
 * Classify createCheckout failures for failover decisions.
 * Definitive unavailable = safe to try backup before any Payment row exists.
 */
export function classifyCreateCheckoutFailure(error: unknown): FailoverClass {
  if (!(error instanceof Error)) return "unknown_or_pending";

  const msg = error.message.toLowerCase();

  // Config / placeholder — payment never created
  if (
    msg.includes("not configured") ||
    msg.includes("configuration") ||
    msg.includes("placeholder") ||
    msg.includes("nexi_secret_api_key") ||
    msg.includes("nexi_checkout_key") ||
    msg.includes("nexi_webhook_secret") ||
    msg.includes("stripe_secret_key") ||
    msg.includes("missing or still a placeholder") ||
    msg.includes("app_url is required") ||
    msg.includes("payment_config")
  ) {
    return "definitive_unavailable";
  }

  if (error instanceof NexiApiError) {
    // Network / unreachable — may have created payment; unknown
    if (error.status === 0) return "unknown_or_pending";
    // Auth / merchant keys rejected — payment not created
    if (error.status === 401 || error.status === 403) return "definitive_unavailable";
    // Nexi rate limit / server errors — unknown whether object exists
    if (error.status === 429 || error.status >= 500) return "unknown_or_pending";
    // 4xx validation (amount, currency, items) — our bug / bad request; not "unavailable"
    if (error.status >= 400 && error.status < 500) return "client_error";
  }

  // Stripe-ish config messages
  if (msg.includes("stripe") && (msg.includes("not configured") || msg.includes("api key"))) {
    return "definitive_unavailable";
  }

  return "unknown_or_pending";
}

export function shouldFailoverToBackup(error: unknown): boolean {
  return classifyCreateCheckoutFailure(error) === "definitive_unavailable";
}

/** Primary is Nets Easy when env is nexi/nets (default). */
export function isNetsEasyPrimary(
  primary: PaymentProviderType = resolvePaymentProviderType()
): boolean {
  return primary === PaymentProviderType.NEXI || primary === PaymentProviderType.NETS;
}
