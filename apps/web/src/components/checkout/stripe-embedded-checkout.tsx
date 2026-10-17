"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type StripeCheckoutFormSdk = {
  createForm: (opts?: { layout?: "expanded" | "compact" }) => StripeCheckoutForm;
  loadActions: () => Promise<
    | { type: "success"; actions: { confirm: (opts: { formConfirmEvent: unknown }) => Promise<unknown> } }
    | { type: "error"; error: { message?: string } }
  >;
};

type StripeCheckoutForm = {
  mount: (selector: string | HTMLElement) => void;
  unmount?: () => void;
  on: (event: "confirm", handler: (event: unknown) => void) => void;
};

type StripeJs = {
  initCheckoutFormSdk: (opts: {
    clientSecret: string | Promise<string>;
    appearance?: {
      theme?: string;
      variables?: Record<string, string>;
    };
  }) => StripeCheckoutFormSdk;
};

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs;
  }
}

type Props = {
  clientSecret: string;
  publishableKey: string;
  checkoutScriptUrl: string;
  orderNumber: string;
  accessToken: string;
  onPaymentCompleted?: () => void;
};

const APPEARANCE = {
  theme: "night" as const,
  variables: {
    colorPrimary: "#f59e0b",
    colorBackground: "#09090b",
    colorText: "#fafafa",
    colorDanger: "#f87171",
    borderRadius: "8px",
  },
};

/**
 * Loads Stripe.js (Dahlia) from js.stripe.com and mounts Checkout Form (ui_mode=form).
 * Never bundles Stripe.js — script is loaded at runtime for PCI compliance.
 */
export function StripeEmbeddedCheckout({
  clientSecret,
  publishableKey,
  checkoutScriptUrl,
  orderNumber,
  accessToken,
  onPaymentCompleted,
}: Props) {
  const router = useRouter();
  const mounted = useRef(false);
  const formRef = useRef<StripeCheckoutForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    let cancelled = false;

    async function mountForm(stripeFactory: NonNullable<Window["Stripe"]>) {
      try {
        const stripe = stripeFactory(publishableKey);
        const checkout = stripe.initCheckoutFormSdk({
          clientSecret,
          appearance: APPEARANCE,
        });

        const form = checkout.createForm({ layout: "expanded" });
        formRef.current = form;
        form.mount("#checkout-form");

        const loadActionsResult = await checkout.loadActions();
        if (loadActionsResult.type === "error") {
          if (!cancelled) {
            setError(loadActionsResult.error.message ?? "Kunne ikke starte Stripe Checkout");
            setLoading(false);
          }
          return;
        }

        form.on("confirm", async (event) => {
          try {
            await loadActionsResult.actions.confirm({ formConfirmEvent: event });
            onPaymentCompleted?.();
            router.push(
              `/orders/${orderNumber}?t=${encodeURIComponent(accessToken)}&checkout=success`
            );
          } catch (e) {
            if (!cancelled) {
              setError(e instanceof Error ? e.message : "Betalingsbekreftelse feilet");
            }
          }
        });

        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Checkout feilet");
          setLoading(false);
        }
      }
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${checkoutScriptUrl}"]`
    );

    if (window.Stripe) {
      void mountForm(window.Stripe);
      return () => {
        cancelled = true;
        formRef.current?.unmount?.();
      };
    }

    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = checkoutScriptUrl;
      script.async = true;
      document.body.appendChild(script);
    }

    script.onload = () => {
      if (!window.Stripe) {
        if (!cancelled) {
          setError("Kunne ikke laste Stripe.js");
          setLoading(false);
        }
        return;
      }
      void mountForm(window.Stripe);
    };
    script.onerror = () => {
      if (!cancelled) {
        setError("Kunne ikke laste betalingsmodul fra Stripe");
        setLoading(false);
      }
    };

    return () => {
      cancelled = true;
      formRef.current?.unmount?.();
    };
  }, [
    clientSecret,
    publishableKey,
    checkoutScriptUrl,
    orderNumber,
    accessToken,
    router,
    onPaymentCompleted,
  ]);

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm text-zinc-400">Laster sikker betaling…</p>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div
        id="checkout-form"
        className="min-h-[320px] rounded-xl border border-zinc-800 bg-zinc-950/80 p-2"
        data-testid="stripe-checkout-form"
      />
      <p className="text-center text-xs text-zinc-500">
        Betaling håndteres av Stripe. Kortnummer går aldri via Ticketly.
      </p>
    </div>
  );
}
