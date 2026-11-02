import Image from "next/image";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { EventService } from "@/services/event-service";
import { formatEventDate, formatEventTime } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import { withCoverCacheBust } from "@/lib/media/cover-url";
import { getAvailableQuantity, resolveUnitPrice } from "@/services/reservation-service";
import { TicketSelector } from "@/components/checkout/ticket-selector";
import { WaitlistJoinForm } from "@/components/checkout/waitlist-join-form";
import { TrackPageView } from "@/components/analytics/track-page-view";
import {
  inventoryHint,
  resolveEventAvailability,
  resolveTicketAvailability,
  type EventSalesContext,
} from "@/lib/tickets/ticket-availability";
import { TicketAvailabilityStatus } from "@/components/tickets/ticket-availability-status";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  // Skip inventory cleanup — metadata does not need live availability counters,
  // and sharing the page+metadata path used to double-run repair work.
  const event = await EventService.getBySlug(slug, { skipInventoryCleanup: true });
  if (!event) return { title: "Arrangement" };
  const title = event.name;
  const description =
    event.shortDescription ??
    event.description?.slice(0, 160) ??
    `${event.name} – billetter via Ticketly`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3456";
  const url = `${appUrl.replace(/\/$/, "")}/events/${event.slug}`;
  const cover = withCoverCacheBust(event.coverImageUrl, event.updatedAt);
  const images = cover ? [{ url: cover, width: 1200, height: 630 }] : undefined;
  const robots =
    event.visibility === "PUBLIC" && event.status === "PUBLISHED"
      ? { index: true, follow: true }
      : { index: false, follow: false };

  return {
    title,
    description,
    robots,
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: cover ? [cover] : undefined,
    },
  };
}

export default async function EventDetailPage({ params }: Props) {
  const { slug } = await params;
  const event = await EventService.getBySlug(slug);
  if (!event) notFound();
  const cover = withCoverCacheBust(event.coverImageUrl, event.updatedAt);

  const eventSales: EventSalesContext = {
    status: event.status,
    salesStartAt: event.salesStartAt,
    salesEndAt: event.salesEndAt,
    salesPausedAt: event.salesPausedAt,
    soldOutDisplay: event.soldOutDisplay,
    timezone: event.timezone,
  };

  const types = event.ticketTypes.map((tt) => ({
    ...tt,
    available: getAvailableQuantity(tt),
    currentPrice: resolveUnitPrice(tt),
  }));

  const typeStatuses = types.map((tt) => ({
    type: tt,
    status: resolveTicketAvailability(eventSales, {
      available: tt.available,
      salesStartAt: tt.salesStartAt,
      salesEndAt: tt.salesEndAt,
      salesPausedAt: tt.salesPausedAt,
      isPubliclyPurchasable: tt.isPubliclyPurchasable,
      isVisible: tt.isVisible,
    }),
  }));

  const overall = resolveEventAvailability(
    eventSales,
    types.map((tt) => ({
      available: tt.available,
      salesStartAt: tt.salesStartAt,
      salesEndAt: tt.salesEndAt,
      salesPausedAt: tt.salesPausedAt,
      isPubliclyPurchasable: tt.isPubliclyPurchasable,
      isVisible: tt.isVisible,
    }))
  );

  const anyPurchasable = typeStatuses.some((t) => t.status.purchasable);
  const allBlockedForWaitlist = typeStatuses.every((t) => !t.status.purchasable);

  return (
    <div>
      <TrackPageView eventId={event.id} organizationId={event.organizationId} />
      <SiteHeader />
      <main>
        <div className="relative aspect-[16/9] max-h-[52vh] min-h-[240px] w-full overflow-hidden border-b border-[color:var(--outline)]/30 sm:max-h-[560px]">
          {cover ? (
            <Image src={cover} alt={event.name} fill className="object-cover" priority sizes="100vw" />
          ) : (
            <div className="h-full bg-[color:var(--surface-high)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 mx-auto max-w-6xl px-4 pb-8">
            <p className="text-sm uppercase tracking-wider text-[color:var(--accent-soft)]">{event.organization.name}</p>
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
                  <Badge variant="muted">{event.ageLimit}+ · Gyldig legitimasjon kreves</Badge>
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
            </div>
          </div>

          <div className="rounded-2xl border border-[color:var(--outline)]/30 bg-zinc-900/50 p-5">
            <h2 className="font-display text-xl">Billetter</h2>
            {!anyPurchasable ? (
              <div className="mt-4">
                <TicketAvailabilityStatus status={overall} />
              </div>
            ) : null}
            <ul className="mt-4 space-y-3">
              {typeStatuses.map(({ type: tt, status }) => {
                const hint = status.purchasable
                  ? inventoryHint(tt.available, {
                      availabilityDisplay: event.availabilityDisplay,
                      lowStockThreshold: event.lowStockThreshold,
                    })
                  : null;
                return (
                  <li
                    key={tt.id}
                    className="flex items-start justify-between gap-3 border-b border-[color:var(--outline)]/30/80 pb-3 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-zinc-100">{tt.name}</p>
                      {tt.description ? (
                        <p className="text-xs text-[color:var(--muted)]">{tt.description}</p>
                      ) : null}
                      {status.purchasable && hint ? (
                        <p className="mt-1 text-xs text-[color:var(--accent-soft)]">{hint}</p>
                      ) : null}
                      {!status.purchasable && !anyPurchasable ? (
                        <TicketAvailabilityStatus status={status} variant="inline" className="mt-1.5" />
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      {status.purchasable ? (
                        <p className="font-semibold text-[color:var(--accent-soft)]">
                          {formatMoney(tt.currentPrice)}
                        </p>
                      ) : (
                        <Badge variant="muted">{status.heading}</Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6">
              {anyPurchasable ? (
                <TicketSelector
                  eventId={event.id}
                  eventSlug={event.slug}
                  eventSales={eventSales}
                  ticketTypes={types.map((t) => ({
                    id: t.id,
                    name: t.name,
                    price: t.currentPrice,
                    available: t.available,
                    minPerOrder: t.minPerOrder,
                    maxPerOrder: t.maxPerOrder,
                    salesStartAt: t.salesStartAt,
                    salesEndAt: t.salesEndAt,
                    salesPausedAt: t.salesPausedAt,
                    isPubliclyPurchasable: t.isPubliclyPurchasable,
                    isVisible: t.isVisible,
                  }))}
                />
              ) : null}
              {event.waitlistEnabled && allBlockedForWaitlist ? (
                <div className="mt-4">
                  <WaitlistJoinForm eventId={event.id} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
