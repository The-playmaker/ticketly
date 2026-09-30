"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";

type TicketTypeOption = {
  id: string;
  name: string;
  price: number;
  available: number;
  minPerOrder: number;
  maxPerOrder: number;
};

function getOrCreateSessionId() {
  if (typeof window === "undefined") return "";
  const key = "ticketly_session";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function TicketSelector({
  eventId,
  eventSlug,
  ticketTypes,
}: {
  eventId: string;
  eventSlug: string;
  ticketTypes: TicketTypeOption[];
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () =>
      ticketTypes
        .map((t) => ({ ticketTypeId: t.id, quantity: qty[t.id] ?? 0, price: t.price, name: t.name }))
        .filter((t) => t.quantity > 0),
    [qty, ticketTypes]
  );

  const total = selected.reduce((s, t) => s + t.price * t.quantity, 0);
  const hasSelection = selected.length > 0;

  async function continueCheckout() {
    setError(null);
    setLoading(true);
    try {
      const sessionId = getOrCreateSessionId();
      const res = await fetch("/api/checkout/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          sessionId,
          items: selected.map((s) => ({ ticketTypeId: s.ticketTypeId, quantity: s.quantity })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunne ikke reservere billetter");

      const params = new URLSearchParams({
        event: eventSlug,
        session: sessionId,
        items: JSON.stringify(
          selected.map((s) => ({ ticketTypeId: s.ticketTypeId, quantity: s.quantity }))
        ),
      });
      router.push(`/checkout?${params.toString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setLoading(false);
    }
  }

  if (ticketTypes.every((t) => t.available <= 0)) {
    return <p className="text-center text-red-400">Utsolgt</p>;
  }

  return (
    <div className="space-y-4">
      {ticketTypes.map((t) => {
        const value = qty[t.id] ?? 0;
        const disabled = t.available <= 0;
        return (
          <div key={t.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-xs text-zinc-500">{formatMoney(t.price)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={disabled || value <= 0}
                onClick={() => setQty((q) => ({ ...q, [t.id]: Math.max(0, value - 1) }))}
              >
                −
              </Button>
              <span className="w-6 text-center text-sm">{value}</span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={disabled || value >= Math.min(t.maxPerOrder, t.available)}
                onClick={() =>
                  setQty((q) => ({
                    ...q,
                    [t.id]: Math.min(t.maxPerOrder, t.available, value + 1),
                  }))
                }
              >
                +
              </Button>
            </div>
          </div>
        );
      })}

      {hasSelection ? (
        <p className="text-sm text-zinc-400">
          Sum billetter: <span className="text-zinc-100">{formatMoney(total)}</span>
          <span className="text-zinc-500"> + serviceavgift i checkout</span>
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button className="w-full" size="lg" disabled={!hasSelection || loading} onClick={continueCheckout}>
        {loading ? "Reserverer…" : "Gå til checkout"}
      </Button>
    </div>
  );
}
