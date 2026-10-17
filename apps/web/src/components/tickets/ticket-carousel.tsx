"use client";

import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TicketQrCard,
  type TicketQrCardEvent,
  type TicketQrCardTicket,
} from "@/components/tickets/ticket-qr-card";
import {
  TICKET_SWIPE_THRESHOLD_PX,
  canNavigateTickets,
  clampTicketIndex,
  nextTicketIndex,
  prevTicketIndex,
  ticketPositionLabel,
} from "@/lib/tickets/ticket-carousel-nav";

export type CarouselTicket = TicketQrCardTicket;

type Props = {
  tickets: CarouselTicket[];
  event: TicketQrCardEvent;
  orderNumber: string;
};

export function TicketCarousel({ tickets, event, orderNumber }: Props) {
  const labelId = useId();
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const count = tickets.length;
  const current = tickets[clampTicketIndex(index, count)];
  const multi = canNavigateTickets(count);

  const goPrev = useCallback(() => {
    setIndex((i) => prevTicketIndex(i, count));
  }, [count]);

  const goNext = useCallback(() => {
    setIndex((i) => nextTicketIndex(i, count));
  }, [count]);

  if (!current) {
    return (
      <p className="text-sm text-zinc-400">Ingen billetter å vise for denne ordren.</p>
    );
  }

  const pdfHref = `/api/tickets/${current.publicId}/pdf${
    current.accessToken ? `?t=${encodeURIComponent(current.accessToken)}` : ""
  }`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-white">Dine billetter</h2>
          <p id={labelId} className="mt-1 text-sm text-[color:var(--accent-soft)]" aria-live="polite">
            {ticketPositionLabel(index, count)}
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href={pdfHref} prefetch={false} target="_blank" rel="noopener noreferrer">
            Last ned PDF
          </Link>
        </Button>
      </div>

      {multi ? (
        <div className="flex items-center justify-center gap-2" role="tablist" aria-label="Velg billett">
          {tickets.map((t, i) => (
            <button
              key={t.publicId}
              type="button"
              role="tab"
              aria-selected={i === clampTicketIndex(index, count)}
              aria-label={`Vis billett ${i + 1} av ${count}`}
              className={
                i === clampTicketIndex(index, count)
                  ? "h-2.5 w-6 rounded-full bg-[color:var(--accent)]"
                  : "h-2.5 w-2.5 rounded-full bg-zinc-600 hover:bg-zinc-500"
              }
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}

      <div
        className="relative touch-pan-y"
        onTouchStart={(e) => {
          touchStartX.current = e.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start == null || !multi) return;
          const end = e.changedTouches[0]?.clientX;
          if (end == null) return;
          const delta = end - start;
          if (Math.abs(delta) < TICKET_SWIPE_THRESHOLD_PX) return;
          if (delta < 0) goNext();
          else goPrev();
        }}
      >
        {/* Only the selected ticket mounts — never multiple QRs at once */}
        <TicketQrCard
          key={current.publicId}
          ticket={current}
          event={event}
          orderNumber={orderNumber}
          hidePdfButton
        />
      </div>

      {multi ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12 min-w-[7.5rem] flex-1 sm:flex-none"
            onClick={goPrev}
            aria-label="Forrige billett"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
            Forrige
          </Button>
          <p className="hidden text-center text-xs text-zinc-500 sm:block" aria-hidden>
            Sveip eller bruk knappene
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12 min-w-[7.5rem] flex-1 sm:flex-none"
            onClick={goNext}
            aria-label="Neste billett"
          >
            Neste
            <ChevronRight className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
