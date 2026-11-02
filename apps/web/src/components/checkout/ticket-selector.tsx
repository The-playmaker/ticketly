"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";
import { toPaymentUserFacingError, toUserFacingError } from "@/lib/user-facing-error";
import {
  availabilityFromErrorCode,
  resolveEventAvailability,
  resolveTicketAvailability,
  technicalErrorPresentation,
  type EventSalesContext,
  type TicketAvailabilityPresentation,
  type TicketTypeSalesContext,
} from "@/lib/tickets/ticket-availability";
import { TicketAvailabilityStatus } from "@/components/tickets/ticket-availability-status";

export type TicketSelectorType = TicketTypeSalesContext & {
  id: string;
  name: string;
  price: number;
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

function extractErrorCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const err = (data as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function TicketSelector({
  eventId,
  eventSlug,
  ticketTypes,
  eventSales,
}: {
  eventId: string;
  eventSlug: string;
  ticketTypes: TicketSelectorType[];
  eventSales: EventSalesContext;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<TicketAvailabilityPresentation | null>(null);

  const statuses = useMemo(
    () =>
      ticketTypes.map((t) => ({
        type: t,
        status: resolveTicketAvailability(eventSales, t),
      })),
    [eventSales, ticketTypes]
  );

  const overall = useMemo(
    () => resolveEventAvailability(eventSales, ticketTypes),
    [eventSales, ticketTypes]
  );

  const selected = useMemo(
    () =>
      statuses
        .filter((s) => s.status.purchasable)
        .map((s) => ({
          ticketTypeId: s.type.id,
          quantity: qty[s.type.id] ?? 0,
          price: s.type.price,
          name: s.type.name,
        }))
        .filter((t) => t.quantity > 0),
    [qty, statuses]
  );

  const total = selected.reduce((s, t) => s + t.price * t.quantity, 0);
  const hasSelection = selected.length > 0;
  const anyPurchasable = statuses.some((s) => s.status.purchasable);

  async function continueCheckout() {
    setFeedback(null);
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
      if (!res.ok) {
        const code = extractErrorCode(data);
        const business = availabilityFromErrorCode(code, {
          timezone: eventSales.timezone,
        });
        if (business) {
          setFeedback(business);
          return;
        }
        setFeedback(
          technicalErrorPresentation(
            toUserFacingError(data, "Vi kunne ikke fullføre forespørselen. Prøv igjen.")
          )
        );
        return;
      }

      const params = new URLSearchParams({
        event: eventSlug,
        session: sessionId,
        items: JSON.stringify(
          selected.map((s) => ({ ticketTypeId: s.ticketTypeId, quantity: s.quantity }))
        ),
      });
      router.push(`/checkout?${params.toString()}`);
    } catch (e) {
      setFeedback(technicalErrorPresentation(toPaymentUserFacingError(e)));
    } finally {
      setLoading(false);
    }
  }

  if (!anyPurchasable) {
    return (
      <div className="space-y-4">
        <TicketAvailabilityStatus status={overall} />
        {statuses.map(({ type, status }) =>
          status.kind !== overall.kind ? (
            <div key={type.id} className="border-t border-[color:var(--outline)]/20 pt-3">
              <p className="text-sm font-medium text-[color:var(--foreground)]">{type.name}</p>
              <TicketAvailabilityStatus status={status} variant="inline" className="mt-1" />
            </div>
          ) : null
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {statuses.map(({ type: t, status }) => {
        const value = qty[t.id] ?? 0;
        const disabled = !status.purchasable;
        return (
          <div key={t.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-xs text-zinc-500">{formatMoney(t.price)}</p>
              {!status.purchasable ? (
                <TicketAvailabilityStatus status={status} variant="inline" className="mt-1.5" />
              ) : null}
            </div>
            <div className="flex items-center gap-2 pt-0.5">
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

      {feedback ? (
        <TicketAvailabilityStatus
          status={feedback}
          onRetry={feedback.tone === "error" ? () => void continueCheckout() : undefined}
        />
      ) : null}

      <Button className="w-full" size="lg" disabled={!hasSelection || loading} onClick={continueCheckout}>
        {loading ? "Reserverer…" : "Gå til checkout"}
      </Button>
    </div>
  );
}
