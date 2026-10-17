import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export function LegalDocShell({
  title,
  version,
  children,
}: {
  title: string;
  version: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">
          Ticketly
        </p>
        <h1 className="mt-2 font-display text-4xl text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">Versjon {version}</p>
        <div className="prose-legal mt-10 space-y-8 text-[15px] leading-relaxed text-zinc-300">
          {children}
        </div>
        <p className="mt-12 text-sm text-[color:var(--muted)]">
          Se også{" "}
          <Link href="/terms" className="text-[color:var(--accent-soft)] hover:underline">
            Kjøpsvilkår
          </Link>
          ,{" "}
          <Link href="/privacy" className="text-[color:var(--accent-soft)] hover:underline">
            Personvern
          </Link>{" "}
          og{" "}
          <Link href="/refund-policy" className="text-[color:var(--accent-soft)] hover:underline">
            Refusjonspolicy
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl text-white">
        {number}. {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
