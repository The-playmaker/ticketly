import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { EventCard } from "@/components/events/event-card";
import { Button } from "@/components/ui/button";
import { EventService } from "@/services/event-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const events = await EventService.listPublic({ take: 6 });

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-[color:var(--outline)]/30">
          <div className="relative mx-auto flex min-h-[70vh] max-w-6xl flex-col justify-center px-4 py-20 sm:py-28">
            <p className="animate-fade-up text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--accent)]">
              Din neste billettplattform
            </p>
            <h1 className="animate-fade-up-delay mt-4 max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl md:text-7xl">
              Finn neste{" "}
              <span className="text-[color:var(--accent)]">opplevelse.</span>
            </h1>
            <p className="animate-fade-up-delay mt-5 max-w-xl text-base text-[color:var(--muted)] sm:text-lg">
              Direktebilletter til konserter, klubbkvelder og festivaler. Uten omveier.
            </p>
            <div className="animate-fade-up-delay mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/events">Se arrangementer</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login?callbackUrl=/admin">For arrangører →</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-semibold text-foreground">
                Kommende arrangementer
              </h2>
              <p className="mt-1 text-[color:var(--muted)]">
                Kjøp billett uten konto — mottar QR direkte.
              </p>
            </div>
            <Link
              href="/events"
              className="text-sm font-medium uppercase tracking-wide text-[color:var(--accent)] hover:brightness-110"
            >
              Se utvalget →
            </Link>
          </div>
          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[color:var(--outline)]/40 p-10 text-center text-[color:var(--muted)]">
              Ingen publiserte arrangementer akkurat nå.
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>

        <section className="border-y border-[color:var(--outline)]/25 bg-[color:var(--surface-container)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold sm:text-3xl">Er du arrangør?</h2>
              <p className="mt-2 max-w-lg text-[color:var(--muted)]">
                Selg billetter med full kontroll, sanntids batch-styring og mobil dørskanning.
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/login?callbackUrl=/admin">Opprett arrangement</Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
