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
  if (data.NODE_ENV === "production") {
    if (data.STRIPE_MOCK_MODE === "true") {
      throw new Error("STRIPE_MOCK_MODE must be false in production");
    }
    if (!data.STRIPE_SECRET_KEY?.startsWith("sk_")) {
      throw new Error("STRIPE_SECRET_KEY required in production");
    }
    if (!data.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
      throw new Error("STRIPE_WEBHOOK_SECRET required in production");
    }
    if (data.STRIPE_SECRET_KEY.startsWith("sk_test_") && env.ALLOW_STRIPE_TEST_IN_PROD !== "true") {
      console.warn("[env] Using Stripe TEST keys in production — set live keys for real sales");
    }
  }

  return data;
}
