import { z } from "zod";
import { isPlaceholderCredential } from "@/lib/payments/nexi-config";

/**
 * Environment validation for production / Vercel / PAYMENT_PROVIDER=nexi.
 * Call from instrumentation or startup — does not throw in development unless
 * FORCE_ENV_VALIDATE=true OR PAYMENT_PROVIDER=nexi with incomplete config.
 * Never auto-falls back to mock, Stripe, or fake success.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  PAYMENT_PROVIDER: z.string().optional(),
  NEXI_ENVIRONMENT: z.enum(["test", "production", "live", "prod"]).optional(),
  NEXI_SECRET_API_KEY: z.string().optional(),
  NEXI_CHECKOUT_KEY: z.string().optional(),
  NEXT_PUBLIC_NEXI_CHECKOUT_KEY: z.string().optional(),
  NEXI_MERCHANT_ID: z.string().optional(),
  NEXI_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_MOCK_MODE: z.enum(["true", "false"]).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  TICKET_TOKEN_SECRET: z.string().min(16).optional(),
  OFFLINE_BUNDLE_SECRET: z.string().min(16).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function paymentProviderName(env: NodeJS.ProcessEnv): string {
  return (env.PAYMENT_PROVIDER ?? "nexi").toLowerCase().trim();
}

function assertNexiEnv(env: NodeJS.ProcessEnv, data: ServerEnv): void {
  if (!data.NEXI_SECRET_API_KEY || isPlaceholderCredential(data.NEXI_SECRET_API_KEY)) {
    throw new Error(
      "NEXI_SECRET_API_KEY required when PAYMENT_PROVIDER=nexi (no mock/Stripe/fake fallback)"
    );
  }
  const checkoutKey = data.NEXI_CHECKOUT_KEY || data.NEXT_PUBLIC_NEXI_CHECKOUT_KEY;
  if (!checkoutKey || isPlaceholderCredential(checkoutKey)) {
    throw new Error("NEXI_CHECKOUT_KEY required when PAYMENT_PROVIDER=nexi");
  }
  if (
    !data.NEXI_WEBHOOK_SECRET ||
    data.NEXI_WEBHOOK_SECRET.length < 8 ||
    data.NEXI_WEBHOOK_SECRET.length > 64 ||
    isPlaceholderCredential(data.NEXI_WEBHOOK_SECRET)
  ) {
    throw new Error("NEXI_WEBHOOK_SECRET (8–64 chars, non-placeholder) required when PAYMENT_PROVIDER=nexi");
  }
  if (!data.APP_URL) {
    throw new Error("APP_URL required when PAYMENT_PROVIDER=nexi (webhook + checkout return URLs)");
  }
  if (!data.DATABASE_URL) {
    throw new Error("DATABASE_URL required when PAYMENT_PROVIDER=nexi");
  }
  const nexiEnv = (data.NEXI_ENVIRONMENT ?? "test").toLowerCase();
  if (data.NODE_ENV === "production" && nexiEnv === "test" && env.ALLOW_NEXI_TEST_IN_PROD !== "true") {
    console.warn(
      "[env] NEXI_ENVIRONMENT=test in production — set production keys for real sales"
    );
  }
}

export function validateServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    const isProd = env.NODE_ENV === "production";
    const force = env.FORCE_ENV_VALIDATE === "true";
    if (isProd || force) {
      throw new Error(`Invalid environment: ${msg}`);
    }
    console.warn("[env] validation warnings:", msg);
    return env as unknown as ServerEnv;
  }

  const data = parsed.data;
  const provider = paymentProviderName(env);
  const isNexi = provider === "nexi" || provider === "nets" || provider === "nexi-checkout" || provider === "nets-easy";
  const isProd = data.NODE_ENV === "production";
  const force = env.FORCE_ENV_VALIDATE === "true";

  // When Nexi is selected, fail clearly — never silently fall back to mock/Stripe.
  if (isNexi && (isProd || force || env.PAYMENT_PROVIDER)) {
    // Skip strict throw only for Vitest unit suites that inject keys themselves mid-test.
    if (env.VITEST !== "true" || force || isProd) {
      try {
        assertNexiEnv(env, data);
      } catch (e) {
        if (isProd || force || (env.PAYMENT_PROVIDER && env.VITEST !== "true")) {
          throw e;
        }
        console.warn("[env]", e instanceof Error ? e.message : e);
      }
    }
  }

  if (isProd) {
    if (provider === "mock" || data.STRIPE_MOCK_MODE === "true") {
      throw new Error(
        "Mock payments are forbidden in production. Set PAYMENT_PROVIDER=nexi (or stripe) and STRIPE_MOCK_MODE=false"
      );
    }

    if (isNexi) {
      assertNexiEnv(env, data);
    } else if (provider === "stripe") {
      if (!data.STRIPE_SECRET_KEY?.startsWith("sk_")) {
        throw new Error("STRIPE_SECRET_KEY required when PAYMENT_PROVIDER=stripe in production");
      }
      if (!data.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
        throw new Error("STRIPE_WEBHOOK_SECRET required when PAYMENT_PROVIDER=stripe");
      }
      if (data.STRIPE_SECRET_KEY.startsWith("sk_test_") && env.ALLOW_STRIPE_TEST_IN_PROD !== "true") {
        console.warn("[env] Using Stripe TEST keys in production — set live keys for real sales");
      }
    } else {
      throw new Error(`Unsupported PAYMENT_PROVIDER=${provider} in production`);
    }

    const emailProvider = (data.EMAIL_PROVIDER ?? "console").toLowerCase().trim();
    if (emailProvider === "console") {
      console.warn(
        "[env] EMAIL_PROVIDER=console in production — transactional email is BLOCKED for launch until a real provider (e.g. resend) is configured"
      );
    } else if (emailProvider === "resend") {
      if (!data.RESEND_API_KEY?.trim() || !data.EMAIL_FROM?.trim()) {
        throw new Error("RESEND_API_KEY and EMAIL_FROM required when EMAIL_PROVIDER=resend");
      }
    }
  }

  return data;
}
