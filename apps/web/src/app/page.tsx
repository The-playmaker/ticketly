import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { EventCard } from "@/components/events/event-card";
import { Button } from "@/components/ui/button";
import { EventService } from "@/services/event-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const events = await EventService.listPublic({ take: 6 });

  return (
    <div>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-zinc-800/80">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url(https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=2000&q=80)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/85 to-zinc-950/40" />
          <div className="relative mx-auto flex min-h-[78vh] max-w-6xl flex-col justify-end px-4 pb-16 pt-28 sm:pb-24">
            <p className="animate-fade-up font-display text-5xl text-white sm:text-7xl md:text-8xl">
              Ticketly
            </p>
            <h1 className="animate-fade-up-delay mt-4 max-w-xl text-xl font-medium text-zinc-200 sm:text-2xl">
              Billettsalg for nattklubber, konserter og events — fra publisering til dørskanning.
            </h1>
            <p className="animate-fade-up-delay mt-3 max-w-lg text-zinc-400">
              Sikkert checkout, QR-billetter og live innsjekking. Bygget for arrangører som trenger mer enn en prototyp.
            </p>
            <div className="animate-fade-up-delay mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/events">Se arrangementer</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Arrangør-innlogging</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl text-white">Kommende arrangementer</h2>
              <p className="mt-1 text-zinc-400">Kjøp billett uten konto — mottar QR direkte.</p>
            </div>
            <Link href="/events" className="text-sm text-amber-400 hover:text-amber-300">
              Vis alle
            </Link>
          </div>
          {events.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-700 p-10 text-center text-zinc-500">
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
      </main>
      <footer className="border-t border-zinc-800 py-10 text-center text-sm text-zinc-500">
        Ticketly · Produksjonsklar billettplattform
      </footer>
    </div>
  );
}
