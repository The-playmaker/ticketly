import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { EventCard } from "@/components/events/event-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getCachedPublicEventList } from "@/lib/cache/cached-reads";
import { CapturePromoterRef } from "@/components/analytics/capture-promoter-ref";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const events = await getCachedPublicEventList(6);

  return (
    <div className="min-h-dvh">
      <CapturePromoterRef />
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-[color:var(--outline)]/30">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 80% 50% at 50% 100%, rgba(255,90,31,0.12), transparent 70%)",
            }}
          />
          <div className="tl-page relative flex min-h-[min(70vh,44rem)] flex-col justify-center py-16 sm:py-24">
            <p className="animate-fade-up tl-eyebrow">Din neste billettplattform</p>
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

        <section className="tl-page tl-section">
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
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
            <EmptyState
              title="Ingen publiserte arrangementer"
              description="Kom tilbake snart — nye events dukker opp her når de publiseres."
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>

        <section className="border-y border-[color:var(--outline)]/25 bg-[color:var(--surface-container)]">
          <div className="tl-page flex flex-col gap-6 py-12 sm:flex-row sm:items-center sm:justify-between sm:py-14">
            <div>
              <h2 className="font-display text-2xl font-semibold sm:text-3xl">Er du arrangør?</h2>
              <p className="mt-2 max-w-lg text-[color:var(--muted)]">
                Selg billetter med full kontroll, sanntids batch-styring og mobil dørskanning.
              </p>
            </div>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/login?callbackUrl=/admin">Opprett arrangement</Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
