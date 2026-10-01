import Stripe from "stripe";
import {
  PaymentProviderType,
  PaymentStatus,
} from "@prisma/client";
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookHandleResult,
} from "./types";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("placeholder")) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(key);
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderType.STRIPE;

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
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
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL");
    }

    return {
      provider: PaymentProviderType.STRIPE,
      sessionId: session.id,
      paymentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
      checkoutUrl: session.url,
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
      status: refund.status === "succeeded" ? "SUCCEEDED" : refund.status === "failed" ? "FAILED" : "PENDING",
      amount: refund.amount,
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
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
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
