/**
 * Nexi Checkout / Nets Easy environment configuration.
 * Secret API key must never leave the server.
 */

export type NexiEnvironment = "test" | "production";

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
  if (!key || key.includes("placeholder") || key.length < 8) {
    throw new Error("NEXI_SECRET_API_KEY is not configured");
  }
  return key;
}

/** Checkout key is client-safe (Nexi identifier). */
export function getNexiCheckoutKey(): string {
  const key =
    process.env.NEXI_CHECKOUT_KEY?.trim() ||
    process.env.NEXT_PUBLIC_NEXI_CHECKOUT_KEY?.trim();
  if (!key || key.includes("placeholder") || key.length < 8) {
    throw new Error("NEXI_CHECKOUT_KEY is not configured");
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
  if (!secret || secret.length < 8 || secret.length > 64) {
    throw new Error(
      "NEXI_WEBHOOK_SECRET must be 8–64 alphanumeric characters (Nexi Authorization header value)"
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
