import Link from "next/link";
import Image from "next/image";
import { formatEventDateTime } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import { withCoverCacheBust } from "@/lib/media/cover-url";
import { getAvailableQuantity, resolveUnitPrice } from "@/services/reservation-service";
import type { Event, Organization, TicketPriceTier, TicketType, Venue } from "@prisma/client";

type EventCardProps = {
  event: Event & {
    organization: Pick<Organization, "name" | "slug">;
    venue: Venue | null;
    ticketTypes: (TicketType & { priceTiers: TicketPriceTier[] })[];
  };
};

export function EventCard({ event }: EventCardProps) {
  const visible = event.ticketTypes.filter((t) => t.isVisible);
  const prices = visible.map((t) => resolveUnitPrice(t));
  const fromPrice = prices.length ? Math.min(...prices) : null;
  const anyAvailable = visible.some((t) => getAvailableQuantity(t) > 0);
  const soldOut = event.status === "SOLD_OUT" || !anyAvailable;
  const lowStock =
    !soldOut &&
    visible.some((t) => {
      const avail = getAvailableQuantity(t);
      return avail > 0 && avail <= Math.max(10, Math.floor(t.quantityReleased * 0.1));
    });

  const cover = withCoverCacheBust(event.coverImageUrl, event.updatedAt);

  return (
    <Link
      href={`/events/${event.slug}`}
      className="group relative block overflow-hidden rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] transition hover:border-[color:var(--accent)]/50"
      data-testid="event-card"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-[color:var(--surface-high)]">
        {cover ? (
          <Image
            src={cover}
            alt={event.name}
            fill
            className="object-cover transition duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-[color:var(--surface-high)] to-[color:var(--background)] text-[color:var(--muted)]">
            {event.name}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--background)] via-[color:var(--background)]/20 to-transparent" />
        <div className="absolute left-3 top-3 rounded bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
          {formatEventDateTime(event.startsAt, event.timezone)}
        </div>
        {soldOut ? (
          <div className="absolute right-3 top-3 rounded bg-red-950/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-200">
            Utsolgt
          </div>
        ) : lowStock ? (
          <div className="absolute right-3 top-3 rounded bg-[color:var(--accent)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--accent-foreground)]">
            Siste billetter
          </div>
        ) : null}
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--accent-soft)]">
            {event.organization.name}
          </p>
          <h3 className="font-display text-2xl font-semibold text-white">{event.name}</h3>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            {event.venue?.name ?? event.city ?? "—"}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--outline)]/25 px-4 py-3">
        <div>
          {soldOut ? (
            <span className="text-sm font-medium text-[color:var(--destructive)]">Utsolgt</span>
          ) : fromPrice != null ? (
            <span className="text-sm text-[color:var(--muted)]">
              Fra <span className="font-semibold text-foreground">{formatMoney(fromPrice)}</span>
            </span>
          ) : null}
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--accent)]">
          Sikre billett →
        </span>
      </div>
    </Link>
  );
}
