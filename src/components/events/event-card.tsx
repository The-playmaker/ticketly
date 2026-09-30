import Link from "next/link";
import Image from "next/image";
import { formatEventDateTime } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
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

  return (
    <Link
      href={`/events/${event.slug}`}
      className="group block overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 transition hover:border-zinc-600"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-zinc-800">
        {event.coverImageUrl ? (
          <Image
            src={event.coverImageUrl}
            alt={event.name}
            fill
            className="object-cover transition duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950 text-zinc-500">
            {event.name}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-transparent to-transparent" />
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-xs uppercase tracking-wider text-amber-300/90">
            {event.organization.name}
          </p>
          <h3 className="font-display text-2xl text-white">{event.name}</h3>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-zinc-300">
            {formatEventDateTime(event.startsAt, event.timezone)}
          </p>
          <p className="text-sm text-zinc-500">
            {event.venue?.name ?? event.city ?? "Oslo"}
          </p>
        </div>
        <div className="text-right">
          {soldOut ? (
            <span className="text-sm font-medium text-red-400">Utsolgt</span>
          ) : fromPrice != null ? (
            <span className="text-sm text-zinc-400">
              Fra <span className="font-semibold text-amber-300">{formatMoney(fromPrice)}</span>
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
