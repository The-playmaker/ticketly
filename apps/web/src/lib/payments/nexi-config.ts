/**
 * Nexi Checkout / Nets Easy environment configuration.
 * Secret API key must never leave the server.
 */

export type NexiEnvironment = "test" | "production";

/** Detect .env.example / seeded fake values — never treat as real merchant keys. */
export function isPlaceholderCredential(value: string | undefined | null): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (v.length < 12) return true;
  const needles = [
    "placeholder",
    "from-portal",
    "change-me",
    "changeme",
    "your_",
    "xxx",
    "example",
    "not_real",
    "not-real",
    "replace_me",
    "replace-me",
  ];
  if (needles.some((n) => v.includes(n))) return true;
  if (v.startsWith("test-secret-key") || v.startsWith("test-checkout-key")) return true;
  if (v === "test" || v === "secret" || v === "checkout") return true;
  return false;
}

export function getNexiEnvironment(): NexiEnvironment {
  const raw = (process.env.NEXI_ENVIRONMENT ?? "test").toLowerCase();
  if (raw === "live" || raw === "prod" || raw === "production") return "production";
  return "test";
}

export function getNexiApiBaseUrl(env: NexiEnvironment = getNexiEnvironment()): string {
  return env === "production"
    ? "https://api.dibspayment.eu"
    : "https://test.api.dibspayment.eu";
}

export function getNexiCheckoutScriptUrl(env: NexiEnvironment = getNexiEnvironment()): string {
  return env === "production"
    ? "https://checkout.dibspayment.eu/v1/checkout.js?v=1"
    : "https://test.checkout.dibspayment.eu/v1/checkout.js?v=1";
}

export function getNexiSecretApiKey(): string {
  const key = process.env.NEXI_SECRET_API_KEY?.trim();
  if (!key || isPlaceholderCredential(key)) {
    throw new Error(
      "NEXI_SECRET_API_KEY is missing or still a placeholder — set real Nexi portal keys (no mock/Stripe fallback)"
    );
  }
  return key;
}

/** Checkout key is client-safe (Nexi identifier). */
export function getNexiCheckoutKey(): string {
  const key =
    process.env.NEXI_CHECKOUT_KEY?.trim() ||
    process.env.NEXT_PUBLIC_NEXI_CHECKOUT_KEY?.trim();
  if (!key || isPlaceholderCredential(key)) {
    throw new Error(
      "NEXI_CHECKOUT_KEY is missing or still a placeholder — set real Nexi checkout key"
    );
  }
  return key;
}

export function getNexiMerchantId(): string | undefined {
  return process.env.NEXI_MERCHANT_ID?.trim() || undefined;
}

/**
 * Shared secret we set on each webhook subscription.
 * Nexi sends it back in the Authorization header.
 */
export function getNexiWebhookAuthorization(): string {
  const secret = process.env.NEXI_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 8 || secret.length > 64 || isPlaceholderCredential(secret)) {
    throw new Error(
      "NEXI_WEBHOOK_SECRET must be 8–64 chars and not a placeholder (Nexi Authorization header value)"
    );
  }
  return secret;
}

export function assertNexiConfiguredForRuntime(): void {
  getNexiSecretApiKey();
  getNexiCheckoutKey();
  getNexiWebhookAuthorization();
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    throw new Error("APP_URL is required for Nexi checkout and webhooks");
  }
  try {
    void new URL(appUrl);
  } catch {
    throw new Error("APP_URL must be a valid absolute URL");
  }
}

export type NexiCredentialStatus = "Configured" | "Missing";

/** Safe config snapshot for admin diagnostics — never includes secret values. */
export function nexiCredentialStatuses(): {
  secretApiKey: NexiCredentialStatus;
  checkoutKey: NexiCredentialStatus;
  webhookSecret: NexiCredentialStatus;
  appUrl: NexiCredentialStatus;
  environment: NexiEnvironment;
  webhookEndpoint: string | null;
} {
  const secret = process.env.NEXI_SECRET_API_KEY?.trim();
  const checkout =
    process.env.NEXI_CHECKOUT_KEY?.trim() ||
    process.env.NEXT_PUBLIC_NEXI_CHECKOUT_KEY?.trim();
  const webhook = process.env.NEXI_WEBHOOK_SECRET?.trim();
  const appUrl = process.env.APP_URL?.trim();
  let webhookEndpoint: string | null = null;
  if (appUrl) {
    try {
      webhookEndpoint = new URL("/api/payments/nexi/webhook", appUrl).toString();
    } catch {
      webhookEndpoint = null;
    }
  }
  return {
    secretApiKey: !secret || isPlaceholderCredential(secret) ? "Missing" : "Configured",
    checkoutKey: !checkout || isPlaceholderCredential(checkout) ? "Missing" : "Configured",
    webhookSecret:
      !webhook || webhook.length < 8 || webhook.length > 64 || isPlaceholderCredential(webhook)
        ? "Missing"
        : "Configured",
    appUrl: appUrl && (() => { try { new URL(appUrl); return true; } catch { return false; } })()
      ? "Configured"
      : "Missing",
    environment: getNexiEnvironment(),
    webhookEndpoint,
  };
}

export function nexiConfigHealth(): {
  status: "operational" | "configuration_error";
  message?: string;
  environment: NexiEnvironment;
} {
  try {
    assertNexiConfiguredForRuntime();
    return { status: "operational", environment: getNexiEnvironment() };
  } catch (e) {
    return {
      status: "configuration_error",
      message: e instanceof Error ? e.message : "Nexi configuration incomplete",
      environment: getNexiEnvironment(),
    };
  }
}
