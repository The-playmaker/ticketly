import { PaymentProviderType } from "@prisma/client";
import type { PaymentProvider } from "./types";
import { StripePaymentProvider } from "./stripe-provider";
import { MockStripePaymentProvider } from "./mock-stripe-provider";
import { VippsPaymentProvider } from "./vipps-provider";

/**
 * Mock Stripe is allowed ONLY in non-production environments when explicitly enabled.
 * Production builds must never accept mock payments / unsigned webhooks.
 */
export function isStripeMockMode(): boolean {
  if (process.env.STRIPE_MOCK_MODE !== "true") return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.ALLOW_MOCK_PAYMENTS === "false") return false;
  return true;
}

export function getPaymentProvider(
  provider: PaymentProviderType = PaymentProviderType.STRIPE
): PaymentProvider {
  switch (provider) {
    case PaymentProviderType.STRIPE:
      return isStripeMockMode()
        ? new MockStripePaymentProvider()
        : new StripePaymentProvider();
    case PaymentProviderType.VIPPS:
      return new VippsPaymentProvider();
    default:
      throw new Error(`Payment provider ${provider} is not configured`);
  }
}

export * from "./types";
