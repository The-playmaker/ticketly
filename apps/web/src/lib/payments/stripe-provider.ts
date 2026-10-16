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

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || key.includes("placeholder") || key.length < 8) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(key);
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
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
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
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
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

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    return {
      provider: PaymentProviderType.STRIPE,
      sessionId: session.id,
      paymentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
      checkoutUrl: session.url,
      integrationType: "HostedPaymentPage",
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
