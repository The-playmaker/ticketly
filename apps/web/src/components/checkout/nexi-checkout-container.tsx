"use client";

import { useState } from "react";
import Link from "next/link";
import { NexiEmbeddedCheckout } from "@/components/checkout/nexi-embedded-checkout";
import {
  checkoutStateCopy,
  resolveCheckoutUiState,
  type CheckoutUiState,
} from "@/lib/checkout/checkout-state";
import { PaymentStatusPoller } from "@/components/orders/payment-status-poller";

type Props = {
  paymentId: string;
  checkoutKey: string;
  checkoutScriptUrl: string;
  orderNumber: string;
  accessToken: string;
  paymentStatus: string;
  paymentAnomaly?: boolean;
  reservationExpiresAt?: string | null;
  reservationStatus?: string | null;
};

/**
 * Clean boundary: Ticketly owns surrounding checkout chrome;
 * Nexi owns sensitive payment UI inside this container.
 * No duplicate pay buttons — Nexi Checkout presents methods and pay action.
 */
export function NexiCheckoutContainer(props: Props) {
  const [clientHint, setClientHint] = useState<"idle" | "completed">("idle");

  const state: CheckoutUiState = resolveCheckoutUiState({
    paymentStatus: props.paymentStatus,
    paymentAnomaly: props.paymentAnomaly,
    reservationExpiresAt: props.reservationExpiresAt,
    reservationStatus: props.reservationStatus,
    awaitingWebhookConfirm: clientHint === "completed",
  });

  const copy = checkoutStateCopy(state);
  const showNexi =
    state === "ACTIVE" ||
    (state === "WAITING_CONFIRMATION" && clientHint !== "completed" && props.paymentStatus === "PENDING");

  return (
    <div className="space-y-4" data-checkout-state={state}>
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

      {showNexi ? (
        <div>
          <NexiEmbeddedCheckout
            paymentId={props.paymentId}
            checkoutKey={props.checkoutKey}
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
