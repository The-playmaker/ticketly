import Image from "next/image";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { EventService } from "@/services/event-service";
import { formatEventDate, formatEventTime } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import { getAvailableQuantity, resolveUnitPrice } from "@/services/reservation-service";
import { TicketSelector } from "@/components/checkout/ticket-selector";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const event = await EventService.getBySlug(slug);
  return { title: event?.name ?? "Arrangement" };
}

export default async function EventDetailPage({ params }: Props) {
  const { slug } = await params;
  const event = await EventService.getBySlug(slug);
  if (!event) notFound();

  const types = event.ticketTypes.map((tt) => ({
    ...tt,
    available: getAvailableQuantity(tt),
    currentPrice: resolveUnitPrice(tt),
  }));

  return (
    <div>
      <SiteHeader />
      <main>
        <div className="relative h-[42vh] min-h-[280px] w-full overflow-hidden border-b border-zinc-800">
          {event.coverImageUrl ? (
            <Image src={event.coverImageUrl} alt={event.name} fill className="object-cover" priority />
          ) : (
            <div className="h-full bg-zinc-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 mx-auto max-w-6xl px-4 pb-8">
            <p className="text-sm uppercase tracking-wider text-amber-300">{event.organization.name}</p>
            <h1 className="font-display text-4xl text-white sm:text-5xl">{event.name}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-sm text-zinc-300">
              <span>{formatEventDate(event.startsAt, event.timezone)}</span>
              <span>·</span>
              <span>
                {formatEventTime(event.startsAt, event.timezone)}
                {event.doorsOpenAt
                  ? ` (dører ${formatEventTime(event.doorsOpenAt, event.timezone)})`
                  : ""}
              </span>
              <span>·</span>
              <span>{event.venue?.name ?? event.city}</span>
              {event.ageLimit ? (
                <>
                  <span>·</span>
                  <Badge variant="muted">{event.ageLimit}+</Badge>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <h2 className="font-display text-2xl">Om arrangementet</h2>
            <p className="mt-3 whitespace-pre-wrap text-zinc-300 leading-relaxed">
              {event.description ?? event.shortDescription}
            </p>
            <div className="mt-6 space-y-1 text-sm text-zinc-400">
              <p>
                {event.address}, {event.postalCode} {event.city}
              </p>
              <p>Kapasitet: {event.capacity}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="font-display text-xl">Billetter</h2>
            <ul className="mt-4 space-y-3">
              {types.map((tt) => {
                const soldOut = tt.available <= 0;
                return (
                  <li
                    key={tt.id}
                    className="flex items-center justify-between border-b border-zinc-800/80 pb-3 last:border-0"
                  >
                    <div>
                      <p className="font-medium text-zinc-100">{tt.name}</p>
                      {tt.description ? (
                        <p className="text-xs text-zinc-500">{tt.description}</p>
                      ) : null}
                      {!soldOut && tt.available <= 30 ? (
                        <p className="text-xs text-amber-400">{tt.available} igjen</p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      {soldOut ? (
                        <Badge variant="danger">Utsolgt</Badge>
                      ) : (
                        <p className="font-semibold text-amber-300">{formatMoney(tt.currentPrice)}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6">
              <TicketSelector
                eventId={event.id}
                eventSlug={event.slug}
                ticketTypes={types.map((t) => ({
                  id: t.id,
                  name: t.name,
                  price: t.currentPrice,
                  available: t.available,
                  minPerOrder: t.minPerOrder,
                  maxPerOrder: t.maxPerOrder,
                }))}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
