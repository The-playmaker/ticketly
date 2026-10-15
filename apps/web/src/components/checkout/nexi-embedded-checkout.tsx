"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    Dibs?: {
      Checkout: new (opts: {
        checkoutKey: string;
        paymentId: string;
        containerId?: string;
        language?: string;
      }) => {
        on: (event: string, cb: (payload?: unknown) => void) => void;
      };
    };
  }
}

type Props = {
  paymentId: string;
  checkoutKey: string;
  checkoutScriptUrl: string;
  orderNumber: string;
  accessToken: string;
  successPath?: string;
};

/**
 * Loads Nexi Checkout.js and mounts EmbeddedCheckout.
 * Ticketly never collects card numbers — Nexi owns the sensitive payment UI.
 */
export function NexiEmbeddedCheckout({
  paymentId,
  checkoutKey,
  checkoutScriptUrl,
  orderNumber,
  accessToken,
  successPath,
}: Props) {
  const router = useRouter();
  const mounted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const script = document.createElement("script");
    script.src = checkoutScriptUrl;
    script.async = true;
    script.onload = () => {
      try {
        if (!window.Dibs?.Checkout) {
          setError("Kunne ikke laste Nexi Checkout");
          setLoading(false);
          return;
        }
        const checkout = new window.Dibs.Checkout({
          checkoutKey,
          paymentId,
          containerId: "nexi-checkout-container",
          language: "nb-NO",
        });
        checkout.on("payment-completed", () => {
          const path =
            successPath ??
            `/orders/${orderNumber}?t=${encodeURIComponent(accessToken)}&checkout=success`;
          router.push(path);
        });
        checkout.on("pay-initialized", () => setLoading(false));
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Checkout feilet");
        setLoading(false);
      }
    };
    script.onerror = () => {
      setError("Kunne ikke laste betalingsmodul fra Nexi");
      setLoading(false);
    };
    document.body.appendChild(script);

    return () => {
      // Keep script for SPA navigation; container is remounted per page
    };
  }, [paymentId, checkoutKey, checkoutScriptUrl, orderNumber, accessToken, router, successPath]);

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm text-zinc-400">Laster sikker betaling…</p>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <div
        id="nexi-checkout-container"
        className="min-h-[320px] rounded-xl border border-zinc-800 bg-zinc-950/80 p-2"
      />
      <p className="text-center text-xs text-zinc-500">
        Betaling håndteres av Nexi Checkout. Kortnummer og Vipps-detaljer går aldri via Ticketly.
      </p>
    </div>
  );
}
