import Link from "next/link";

export function SiteFooter({
  supportEmail,
  supportPhone,
}: {
  supportEmail?: string | null;
  supportPhone?: string | null;
} = {}) {
  return (
    <footer className="border-t border-[color:var(--outline)]/25 bg-[color:var(--surface-low)]/40 py-10 tl-safe-bottom">
      <div className="tl-page flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-foreground">
            Ticketly
          </p>
          <p className="mt-2 max-w-sm text-sm text-[color:var(--muted)]">
            Produksjonsklar billettplattform for arrangementer, konserter og nattklubber.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[color:var(--muted)]">
          <Link href="/terms" className="hover:text-foreground">
            Kjøpsvilkår
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Personvern
          </Link>
          <Link href="/refund-policy" className="hover:text-foreground">
            Refusjon
          </Link>
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`} className="hover:text-foreground">
              Kontakt
            </a>
          ) : (
            <Link href="/login?callbackUrl=/admin" className="hover:text-foreground">
              Kontakt
            </Link>
          )}
          <Link href="/login?callbackUrl=/admin" className="hover:text-foreground">
            Arrangørinnlogging
          </Link>
        </div>
        <div className="space-y-1 text-xs text-[color:var(--muted)] sm:text-right">
          {supportPhone ? <p>Telefon: {supportPhone}</p> : null}
          {supportEmail ? <p>{supportEmail}</p> : null}
          <p>© {new Date().getFullYear()} Ticketly</p>
        </div>
      </div>
    </footer>
  );
}
