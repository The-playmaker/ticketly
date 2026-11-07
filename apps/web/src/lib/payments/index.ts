import { PaymentProviderType } from "@prisma/client";
import type { PaymentProvider } from "./types";
import { StripePaymentProvider } from "./stripe-provider";
import { MockStripePaymentProvider } from "./mock-stripe-provider";
import { VippsPaymentProvider } from "./vipps-provider";
import { NexiCheckoutProvider } from "./nexi-provider";
import { MockPaymentProvider } from "./mock-provider";
import { isMockPaymentMode, resolvePaymentProviderType } from "./resolve-provider";

export {
  isMockPaymentMode,
  isStripeMockMode,
  resolvePaymentProviderType,
} from "./resolve-provider";

export {
  resolveBackupProviderType,
  isBackupConfigured,
  classifyCreateCheckoutFailure,
  shouldFailoverToBackup,
  isNetsEasyPrimary,
} from "./failover";
export type { FailoverClass } from "./failover";

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
export {
  StripePaymentProvider,
  stripeConfigHealth,
  STRIPE_CHECKOUT_SCRIPT_URL,
  getStripePublishableKey,
  retrieveStripeCheckoutClientSecret,
} from "./stripe-provider";
export { MockStripePaymentProvider } from "./mock-stripe-provider";
export {
  createLiveStripeLookupClient,
  lookupStripeForPayment,
  normalizeStripeLookupIds,
  isStripeCheckoutSessionId,
  isStripePaymentIntentId,
} from "./stripe-lookup";
export type {
  StripeLookupClient,
  StripeOrderLookup,
  StripeSessionSnapshot,
  StripePaymentIntentSnapshot,
  StripeRefundSnapshot,
} from "./stripe-lookup";
export { withStripeRetry, mapWithConcurrency } from "./stripe-retry";
export {
  lookupNexiForPayment,
  nexiPaymentIsPaid,
  nexiPaymentIsFailed,
  nexiPaymentIsCancelledOrExpired,
  type NexiOrderLookup,
  type NexiLookupClient,
} from "./nexi-lookup";
