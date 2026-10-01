import { PaymentProviderType } from "@prisma/client";
import type { PaymentProvider } from "./types";
import { StripePaymentProvider } from "./stripe-provider";
import { MockStripePaymentProvider } from "./mock-stripe-provider";
import { VippsPaymentProvider } from "./vipps-provider";

export function isStripeMockMode(): boolean {
  return process.env.STRIPE_MOCK_MODE === "true";
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
