"use client";

import { useState } from "react";
import Link from "next/link";
import { StripeEmbeddedCheckout } from "@/components/checkout/stripe-embedded-checkout";
import {
  checkoutStateCopy,
  resolveCheckoutUiState,
  type CheckoutUiState,
} from "@/lib/checkout/checkout-state";
import { PaymentStatusPoller } from "@/components/orders/payment-status-poller";

type Props = {
  clientSecret: string;
  publishableKey: string;
  checkoutScriptUrl: string;
  orderNumber: string;
  accessToken: string;
  paymentStatus: string;
  paymentAnomaly?: boolean;
  reservationExpiresAt?: string | null;
  reservationStatus?: string | null;
};

/**
 * Ticketly owns surrounding checkout chrome;
 * Stripe Checkout Form owns sensitive payment UI inside this container.
 */
export function StripeCheckoutContainer(props: Props) {
  const [clientHint, setClientHint] = useState<"idle" | "completed">("idle");

  const state: CheckoutUiState = resolveCheckoutUiState({
    paymentStatus: props.paymentStatus,
    paymentAnomaly: props.paymentAnomaly,
    reservationExpiresAt: props.reservationExpiresAt,
    reservationStatus: props.reservationStatus,
    awaitingWebhookConfirm: clientHint === "completed",
  });

  const copy = checkoutStateCopy(state);
  const showStripe =
    state === "ACTIVE" ||
    (state === "WAITING_CONFIRMATION" &&
      clientHint !== "completed" &&
      props.paymentStatus === "PENDING");

  return (
    <div className="space-y-4" data-checkout-state={state} data-provider="stripe">
      <div>
        <h2 className="text-lg font-medium text-white">{copy.title}</h2>
        <p className="mt-1 text-sm text-zinc-400">{copy.body}</p>
      </div>

      {state === "WAITING_CONFIRMATION" || state === "PROCESSING" ? (
        <PaymentStatusPoller
          orderNumber={props.orderNumber}
          accessToken={props.accessToken}
          initialStatus={props.paymentStatus}
        />
      ) : null}

      {state === "PAID" ? (
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-500 px-4 text-sm font-medium text-zinc-950"
          href={`/orders/${props.orderNumber}?t=${encodeURIComponent(props.accessToken)}`}
        >
          Se billettene
        </Link>
      ) : null}

      {state === "FAILED" || state === "RESERVATION_EXPIRED" || state === "REVIEW_REQUIRED" ? (
        <Link
          className="inline-flex min-h-11 items-center text-sm text-amber-400 underline"
          href="/events"
        >
          Tilbake til arrangementer
        </Link>
      ) : null}

      {showStripe ? (
        <div>
          <StripeEmbeddedCheckout
            clientSecret={props.clientSecret}
            publishableKey={props.publishableKey}
            checkoutScriptUrl={props.checkoutScriptUrl}
            orderNumber={props.orderNumber}
            accessToken={props.accessToken}
            onPaymentCompleted={() => setClientHint("completed")}
          />
        </div>
      ) : null}
    </div>
  );
}
