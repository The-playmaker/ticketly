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
  const ticketCount = selected.reduce((s, t) => s + t.quantity, 0);
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
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--outline)]/20 bg-[color:var(--surface-low)]/40 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t.name}</p>
              <p className="text-xs tabular-nums text-[color:var(--muted)]">{formatMoney(t.price)}</p>
              {!status.purchasable ? (
                <TicketAvailabilityStatus status={status} variant="inline" className="mt-1.5" />
              ) : null}
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label={`Antall ${t.name}`}>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-11 w-11 sm:h-10 sm:w-10"
                disabled={disabled || value <= 0}
                aria-label={`Fjern en ${t.name}`}
                onClick={() => setQty((q) => ({ ...q, [t.id]: Math.max(0, value - 1) }))}
              >
                −
              </Button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                {value}
              </span>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-11 w-11 sm:h-10 sm:w-10"
                disabled={disabled || value >= Math.min(t.maxPerOrder, t.available)}
                aria-label={`Legg til en ${t.name}`}
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
        <div className="rounded-lg border border-[color:var(--outline)]/25 bg-[color:var(--surface-high)]/40 px-3 py-3">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-[color:var(--muted)]">
              {ticketCount} {ticketCount === 1 ? "billett" : "billetter"}
            </span>
            <span className="font-semibold tabular-nums text-foreground">{formatMoney(total)}</span>
          </div>
          <p className="mt-1 text-xs text-[color:var(--muted)]">Serviceavgift beregnes i checkout</p>
        </div>
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
