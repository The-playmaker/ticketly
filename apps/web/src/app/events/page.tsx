import { SiteHeader } from "@/components/layout/site-header";
import { EventCard } from "@/components/events/event-card";
import { EventService } from "@/services/event-service";

export const metadata = { title: "Arrangementer" };
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await EventService.listPublic();

  return (
    <div>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="font-display text-4xl font-semibold text-foreground">Arrangementer</h1>
        <p className="mt-2 text-[color:var(--muted)]">
          Finn konserter, klubbkvelder og events nær deg.
        </p>
        {events.length === 0 ? (
          <p className="mt-10 rounded-lg border border-dashed border-[color:var(--outline)]/40 p-10 text-center text-[color:var(--muted)]">
            Ingen publiserte arrangementer akkurat nå.
          </p>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
