"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Success page is NOT payment proof. Poll order status briefly while webhook arrives.
 */
export function PaymentStatusPoller({
  orderNumber,
  accessToken,
  initialStatus,
}: {
  orderNumber: string;
  accessToken: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    if (initialStatus === "PAID") return;
    let cancelled = false;
    const maxTicks = 20; // ~40s

    const id = setInterval(async () => {
      if (cancelled) return;
      setTicks((t) => t + 1);
      try {
        const res = await fetch(
          `/api/orders/${encodeURIComponent(orderNumber)}/status?t=${encodeURIComponent(accessToken)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        setStatus(data.paymentStatus);
        if (data.paymentStatus === "PAID") {
          clearInterval(id);
          router.refresh();
        }
      } catch {
        // ignore transient errors
      }
    }, 2000);

    const stop = setTimeout(() => clearInterval(id), maxTicks * 2000);

    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [orderNumber, accessToken, initialStatus, router]);

  if (status === "PAID") return null;

  return (
    <p className="mt-3 text-sm text-zinc-400" aria-live="polite">
      Vi bekrefter betalingen…{ticks > 0 ? ` (${ticks})` : ""}
    </p>
  );
}
