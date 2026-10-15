import { PaymentProviderType } from "@prisma/client";
import type { PaymentProvider } from "./types";
import { StripePaymentProvider } from "./stripe-provider";
import { MockStripePaymentProvider } from "./mock-stripe-provider";
import { VippsPaymentProvider } from "./vipps-provider";
import { NexiCheckoutProvider } from "./nexi-provider";
import { MockPaymentProvider } from "./mock-provider";

/**
 * Mock payments are allowed ONLY when PAYMENT_PROVIDER=mock (or legacy STRIPE_MOCK_MODE)
 * and never in production unless explicitly PAYMENT_PROVIDER=mock is forbidden there too.
 */
export function isMockPaymentMode(): boolean {
  const provider = (process.env.PAYMENT_PROVIDER ?? "").toLowerCase();
  if (provider === "mock") {
    return process.env.NODE_ENV !== "production";
  }
  // Legacy Stripe mock path
  if (process.env.STRIPE_MOCK_MODE !== "true") return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.ALLOW_MOCK_PAYMENTS === "false") return false;
  return true;
}

/** @deprecated use isMockPaymentMode */
export function isStripeMockMode(): boolean {
  return isMockPaymentMode();
}

/**
 * Resolve active payment provider from env.
 * Production default: NEXI.
 * Stripe is optional/fallback. Mock never defaults in production.
 */
export function resolvePaymentProviderType(): PaymentProviderType {
  const raw = (process.env.PAYMENT_PROVIDER ?? "nexi").toLowerCase().trim();

  if (process.env.NODE_ENV === "production") {
    if (raw === "mock") {
      throw new Error(
        "PAYMENT_PROVIDER=mock is forbidden in production. Configure Nexi or Stripe."
      );
    }
  }

  switch (raw) {
    case "nexi":
    case "nets":
    case "nets-easy":
    case "nexi-checkout":
      return PaymentProviderType.NEXI;
    case "stripe":
      return PaymentProviderType.STRIPE;
    case "vipps":
      return PaymentProviderType.VIPPS;
    case "mock":
      return PaymentProviderType.MOCK;
    default:
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Unknown PAYMENT_PROVIDER=${raw}`);
      }
      return PaymentProviderType.NEXI;
  }
}

export function getPaymentProvider(
  provider: PaymentProviderType = resolvePaymentProviderType()
): PaymentProvider {
  switch (provider) {
    case PaymentProviderType.NEXI:
    case PaymentProviderType.NETS:
      return new NexiCheckoutProvider();
    case PaymentProviderType.STRIPE:
      return isMockPaymentMode()
        ? new MockStripePaymentProvider()
        : new StripePaymentProvider();
    case PaymentProviderType.VIPPS:
      return new VippsPaymentProvider();
    case PaymentProviderType.MOCK:
      if (process.env.NODE_ENV === "production") {
        throw new Error("Mock payment provider is forbidden in production");
      }
      return new MockPaymentProvider();
    default:
      throw new Error(`Payment provider ${provider} is not configured`);
  }
}

export * from "./types";
export * from "./nexi-config";
export { NexiCheckoutProvider } from "./nexi-provider";
export { NexiApiError } from "./nexi-client";
