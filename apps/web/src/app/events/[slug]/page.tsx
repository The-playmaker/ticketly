import Image from "next/image";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
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
    <div className="min-h-dvh">
      <TrackPageView eventId={event.id} organizationId={event.organizationId} />
      <SiteHeader />
      <main>
        <div className="relative aspect-[16/10] max-h-[48vh] min-h-[220px] w-full overflow-hidden border-b border-[color:var(--outline)]/30 sm:aspect-[21/9] sm:max-h-[560px]">
          {cover ? (
            <Image src={cover} alt={event.name} fill className="object-cover" priority sizes="100vw" />
          ) : (
            <div className="h-full bg-gradient-to-br from-[color:var(--surface-high)] to-[color:var(--background)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--background)] via-[color:var(--background)]/55 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0">
          <div className="tl-page pb-7 sm:pb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-soft)] sm:text-sm">{event.organization.name}</p>
            <h1 className="mt-1 font-display text-3xl font-bold text-white sm:text-5xl">{event.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-[color:var(--muted)]">
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
        </div>

        <div className="tl-page grid gap-8 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10 lg:py-12">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold sm:text-2xl">Om arrangementet</h2>
            <p className="mt-3 whitespace-pre-wrap text-[color:var(--muted)] leading-relaxed">
              {event.description ?? event.shortDescription}
            </p>
            <div className="mt-6 rounded-lg border border-[color:var(--outline)]/25 bg-[color:var(--surface-low)]/60 px-4 py-3 text-sm text-[color:var(--muted)]">
              <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]/80">Sted</p>
              <p className="mt-1 text-foreground">
                {event.venue?.name ? `${event.venue.name} · ` : null}
                {event.address}, {event.postalCode} {event.city}
              </p>
            </div>
          </div>

          <aside className="tl-panel h-fit p-4 sm:p-5 lg:sticky lg:top-20">
            <h2 className="font-display text-lg font-semibold sm:text-xl">Billetter</h2>
            {!anyPurchasable ? (
              <div className="mt-4">
                <TicketAvailabilityStatus status={overall} />
              </div>
            ) : null}
            <ul className="mt-4 space-y-0">
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
                    className="flex items-start justify-between gap-3 border-b border-[color:var(--outline)]/25 py-3 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{tt.name}</p>
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
            <div className="mt-5">
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
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
