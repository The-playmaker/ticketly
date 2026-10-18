/**
 * Stripe read helpers for payment reconciliation.
 * Never returns client_secret or card data.
 */

import Stripe from "stripe";
import { withStripeRetry } from "./stripe-retry";

const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

export type StripeSessionSnapshot = {
  id: string;
  status: string | null;
  paymentStatus: string | null;
  amountTotal: number | null;
  currency: string | null;
  livemode: boolean;
  metadata: Record<string, string>;
  paymentIntentId: string | null;
};

export type StripePaymentIntentSnapshot = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  livemode: boolean;
  metadata: Record<string, string>;
  lastPaymentErrorCode: string | null;
  /** Radar / risk signals from latest charge outcome */
  outcomeType: string | null;
  riskLevel: string | null;
  amountRefunded: number;
  chargeId: string | null;
};

export type StripeRefundSnapshot = {
  id: string;
  amount: number;
  currency: string;
  status: string | null;
  paymentIntentId: string | null;
};

export type StripeOrderLookup = {
  session: StripeSessionSnapshot | null;
  paymentIntent: StripePaymentIntentSnapshot | null;
  refunds: StripeRefundSnapshot[];
};

export type StripeLookupClient = {
  retrieveSession(sessionId: string): Promise<StripeSessionSnapshot | null>;
  retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntentSnapshot | null>;
  listRefunds(paymentIntentId: string): Promise<StripeRefundSnapshot[]>;
};

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || key.includes("placeholder") || key.length < 8) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

function mapSession(session: Stripe.Checkout.Session): StripeSessionSnapshot {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  return {
    id: session.id,
    status: session.status ?? null,
    paymentStatus: session.payment_status ?? null,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    livemode: !!session.livemode,
    metadata: meta,
    paymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
  };
}

function mapPaymentIntent(pi: Stripe.PaymentIntent): StripePaymentIntentSnapshot {
  const meta = (pi.metadata ?? {}) as Record<string, string>;
  const charges =
    "charges" in pi && pi.charges && typeof pi.charges === "object" && "data" in pi.charges
      ? (pi.charges as { data: Stripe.Charge[] }).data
      : [];
  const latest = charges[0];
  const amountRefunded = charges.reduce((s, c) => s + (c.amount_refunded ?? 0), 0);
  return {
    id: pi.id,
    status: pi.status,
    amount: pi.amount,
    currency: pi.currency,
    livemode: !!pi.livemode,
    metadata: meta,
    lastPaymentErrorCode: pi.last_payment_error?.code ?? null,
    outcomeType: latest?.outcome?.type ?? null,
    riskLevel: latest?.outcome?.risk_level ?? null,
    amountRefunded,
    chargeId: latest?.id ?? null,
  };
}

function mapRefund(r: Stripe.Refund): StripeRefundSnapshot {
  return {
    id: r.id,
    amount: r.amount,
    currency: r.currency,
    status: r.status ?? null,
    paymentIntentId:
      typeof r.payment_intent === "string" ? r.payment_intent : r.payment_intent?.id ?? null,
  };
}

/** Live Stripe lookup with retry. Safe for production reconciliation. */
export function createLiveStripeLookupClient(): StripeLookupClient {
  return {
    async retrieveSession(sessionId: string) {
      if (!sessionId || sessionId.startsWith("free_") || sessionId.startsWith("mock_")) {
        return null;
      }
      return withStripeRetry(async () => {
        const stripe = getStripe();
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          return mapSession(session);
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404) return null;
          throw err;
        }
      });
    },

    async retrievePaymentIntent(paymentIntentId: string) {
      if (!paymentIntentId || paymentIntentId.startsWith("free_") || paymentIntentId.startsWith("mock_")) {
        return null;
      }
      return withStripeRetry(async () => {
        const stripe = getStripe();
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ["latest_charge"],
          });
          // Prefer expanded latest_charge for outcome; fall back to list
          let snapshot = mapPaymentIntent(pi);
          const latest = pi.latest_charge;
          if (latest && typeof latest !== "string") {
            snapshot = {
              ...snapshot,
              outcomeType: latest.outcome?.type ?? snapshot.outcomeType,
              riskLevel: latest.outcome?.risk_level ?? snapshot.riskLevel,
              amountRefunded: latest.amount_refunded ?? snapshot.amountRefunded,
              chargeId: latest.id,
            };
          }
          return snapshot;
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404) return null;
          throw err;
        }
      });
    },

    async listRefunds(paymentIntentId: string) {
      if (!paymentIntentId || paymentIntentId.startsWith("free_") || paymentIntentId.startsWith("mock_")) {
        return [];
      }
      return withStripeRetry(async () => {
        const stripe = getStripe();
        const list = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
        return list.data.map(mapRefund);
      });
    },
  };
}

export async function lookupStripeForPayment(
  client: StripeLookupClient,
  ids: { sessionId?: string | null; paymentIntentId?: string | null }
): Promise<StripeOrderLookup> {
  let session: StripeSessionSnapshot | null = null;
  let paymentIntent: StripePaymentIntentSnapshot | null = null;
  let refunds: StripeRefundSnapshot[] = [];

  if (ids.sessionId) {
    session = await client.retrieveSession(ids.sessionId);
  }

  const piId = ids.paymentIntentId || session?.paymentIntentId || null;
  if (piId) {
    paymentIntent = await client.retrievePaymentIntent(piId);
    refunds = await client.listRefunds(piId);
  }

  return { session, paymentIntent, refunds };
}
