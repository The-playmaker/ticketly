import { z } from "zod";

/**
 * Environment validation for production / Vercel.
 * Call from instrumentation or startup — does not throw in development unless FORCE_ENV_VALIDATE=true.
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
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function paymentProviderName(env: NodeJS.ProcessEnv): string {
  return (env.PAYMENT_PROVIDER ?? "nexi").toLowerCase().trim();
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

  if (data.NODE_ENV === "production") {
    if (provider === "mock" || data.STRIPE_MOCK_MODE === "true") {
      throw new Error(
        "Mock payments are forbidden in production. Set PAYMENT_PROVIDER=nexi (or stripe) and STRIPE_MOCK_MODE=false"
      );
    }

    if (provider === "nexi" || provider === "nets" || provider === "nexi-checkout") {
      if (!data.NEXI_SECRET_API_KEY || data.NEXI_SECRET_API_KEY.includes("placeholder")) {
        throw new Error("NEXI_SECRET_API_KEY required when PAYMENT_PROVIDER=nexi in production");
      }
      const checkoutKey = data.NEXI_CHECKOUT_KEY || data.NEXT_PUBLIC_NEXI_CHECKOUT_KEY;
      if (!checkoutKey || checkoutKey.includes("placeholder")) {
        throw new Error("NEXI_CHECKOUT_KEY required when PAYMENT_PROVIDER=nexi in production");
      }
      if (!data.NEXI_WEBHOOK_SECRET || data.NEXI_WEBHOOK_SECRET.length < 8) {
        throw new Error("NEXI_WEBHOOK_SECRET (8–64 chars) required when PAYMENT_PROVIDER=nexi");
      }
      const nexiEnv = (data.NEXI_ENVIRONMENT ?? "production").toLowerCase();
      if (nexiEnv === "test" && env.ALLOW_NEXI_TEST_IN_PROD !== "true") {
        console.warn(
          "[env] NEXI_ENVIRONMENT=test in production — set production keys for real sales"
        );
      }
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
  }

  return data;
}
