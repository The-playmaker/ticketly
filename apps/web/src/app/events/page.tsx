import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { EventCard } from "@/components/events/event-card";
import { EmptyState } from "@/components/ui/empty-state";
import { EventService } from "@/services/event-service";

export const metadata = { title: "Arrangementer" };
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await EventService.listPublic();

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="tl-page py-10 sm:py-12">
        <p className="tl-eyebrow">Utforsk</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-foreground sm:text-4xl">
          Arrangementer
        </h1>
        <p className="mt-2 max-w-xl text-[color:var(--muted)]">
          Finn konserter, klubbkvelder og events nær deg.
        </p>
        {events.length === 0 ? (
          <EmptyState
            className="mt-10"
            title="Ingen publiserte arrangementer"
            description="Det er ingen aktive salg akkurat nå. Sjekk igjen snart."
          />
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
