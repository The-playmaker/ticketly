import Stripe from "stripe";
import { PaymentProviderType, PaymentStatus } from "@prisma/client";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookHandleResult,
} from "./types";

/** Dahlia API version required for Checkout Session `ui_mode: "form"`. */
const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

export const STRIPE_CHECKOUT_SCRIPT_URL = "https://js.stripe.com/dahlia/stripe.js";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || key.includes("placeholder") || key.length < 8) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

export function getStripePublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!key || key.includes("placeholder") || key.length < 8) {
    throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured");
  }
  return key;
}

/** Re-fetch client_secret for an existing Checkout Session (page refresh / payment page). */
export async function retrieveStripeCheckoutClientSecret(sessionId: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session.client_secret) {
    throw new Error("Stripe session has no client_secret (expired or wrong ui_mode)");
  }
  return session.client_secret;
}

function stripeConfigured(): boolean {
  try {
    getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret || secret.includes("placeholder") || secret.length < 8) return false;
    return true;
  } catch {
    return false;
  }
}

function mapStripePaymentMethod(
  session: Stripe.Checkout.Session
): { paymentMethod?: string; paymentType?: string } {
  const types = session.payment_method_types ?? [];
  const primary = types[0]?.toUpperCase();
  if (!primary) return {};
  if (primary === "CARD") return { paymentMethod: "CARD", paymentType: "CARD" };
  if (primary === "LINK") return { paymentMethod: "LINK", paymentType: "WALLET" };
  return { paymentMethod: primary, paymentType: "OTHER" };
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderType.STRIPE;

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const stripe = getStripe();
    // Scenario A — embedded Checkout Form (ui_mode: form).
    // fixed_by_ui params from Checkout Studio; sample_only mode/line_items preserved.
    // Rule 8: payment_method_collection only for subscription mode — omitted (mode=payment).
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        ui_mode: "form",
        customer_email: input.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amount,
              product_data: {
                name: input.description,
              },
            },
          },
        ],
        // Form UI uses return_url (not success_url/cancel_url)
        return_url: input.successUrl,
        billing_address_collection: "auto",
        phone_number_collection: { enabled: false },
        automatic_tax: { enabled: false },
        submit_type: "auto",
        name_collection: { individual: { enabled: true } },
        integration_identifier: "custom_embedded_web_0001",
        // Ticketly fulfillment — retained outside Studio field list
        metadata: {
          orderId: input.orderId,
          orderNumber: input.orderNumber,
          ...input.metadata,
        },
        payment_intent_data: {
          metadata: {
            orderId: input.orderId,
            orderNumber: input.orderNumber,
          },
        },
      },
      { idempotencyKey: `checkout_${input.orderId}` }
    );

    if (!session.client_secret) {
      throw new Error("Stripe did not return a checkout client_secret");
    }

    return {
      provider: PaymentProviderType.STRIPE,
      sessionId: session.id,
      paymentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
      clientSecret: session.client_secret,
      checkoutKey: getStripePublishableKey(),
      checkoutScriptUrl: STRIPE_CHECKOUT_SCRIPT_URL,
      integrationType: "EmbeddedCheckout",
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const stripe = getStripe();
    const refund = await stripe.refunds.create(
      {
        payment_intent: input.providerPaymentId,
        amount: input.amount,
        reason: "requested_by_customer",
        metadata: input.reason ? { reason: input.reason } : undefined,
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
    );

    return {
      providerRefundId: refund.id,
      status:
        refund.status === "succeeded"
          ? "SUCCEEDED"
          : refund.status === "failed"
            ? "FAILED"
            : "PENDING",
      amount: refund.amount,
    };
  }

  async getHealth() {
    if (!stripeConfigured()) {
      return {
        status: "configuration_error" as const,
        message: "STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing or placeholder",
      };
    }
    const key = process.env.STRIPE_SECRET_KEY ?? "";
    const env = key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
    return {
      status: "operational" as const,
      message: `Stripe ${env} keys configured`,
    };
  }

  async parseWebhook(rawBody: string | Buffer, signature: string | null): Promise<WebhookHandleResult> {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !signature) {
      throw new Error("Missing Stripe webhook secret or signature");
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Fulfill only when payment is not unpaid (async methods can complete unpaid)
        if (session.payment_status === "unpaid") {
          return {
            handled: false,
            type: event.type,
            externalEventId: event.id,
            orderId: session.metadata?.orderId,
            providerSessionId: session.id,
            providerStatus: session.payment_status,
            raw: session,
          };
        }
        const method = mapStripePaymentMethod(session);
        return {
          handled: true,
          type: event.type,
          externalEventId: event.id,
          orderId: session.metadata?.orderId,
          paymentStatus: PaymentStatus.PAID,
          providerSessionId: session.id,
          providerPaymentId:
            typeof session.payment_intent === "string" ? session.payment_intent : undefined,
          amount: session.amount_total ?? undefined,
          currency: session.currency ?? undefined,
          paymentMethod: method.paymentMethod,
          paymentType: method.paymentType,
          providerStatus: session.payment_status ?? undefined,
          raw: session,
        };
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          handled: true,
          type: event.type,
          externalEventId: event.id,
          orderId: session.metadata?.orderId,
          paymentStatus: PaymentStatus.FAILED,
          providerSessionId: session.id,
          providerPaymentId:
            typeof session.payment_intent === "string" ? session.payment_intent : undefined,
          providerStatus: session.payment_status ?? undefined,
          raw: session,
        };
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        return {
          handled: true,
          type: event.type,
          externalEventId: event.id,
          orderId: pi.metadata?.orderId,
          paymentStatus: PaymentStatus.PAID,
          providerPaymentId: pi.id,
          amount: pi.amount,
          currency: pi.currency ?? undefined,
          paymentMethod: typeof pi.payment_method === "string" ? undefined : undefined,
          providerStatus: pi.status,
          raw: pi,
        };
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        return {
          handled: true,
          type: event.type,
          externalEventId: event.id,
          orderId: pi.metadata?.orderId,
          paymentStatus: PaymentStatus.FAILED,
          providerPaymentId: pi.id,
          providerStatus: pi.status,
          raw: pi,
        };
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        return {
          handled: true,
          type: event.type,
          externalEventId: event.id,
          providerPaymentId:
            typeof charge.payment_intent === "string" ? charge.payment_intent : undefined,
          paymentStatus: charge.refunded
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED,
          amount: charge.amount_refunded,
          raw: charge,
        };
      }
      default:
        return {
          handled: false,
          type: event.type,
          externalEventId: event.id,
        };
    }
  }
}

export function stripeConfigHealth(): {
  status: "operational" | "configuration_error";
  message?: string;
  mode: "test" | "live" | "unknown" | "missing";
} {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!key || key.includes("placeholder") || !secret || secret.includes("placeholder")) {
    return { status: "configuration_error", message: "Stripe keys not configured", mode: "missing" };
  }
  const mode = key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
  return { status: "operational", mode };
}
