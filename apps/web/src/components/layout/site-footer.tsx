import Link from "next/link";

export function SiteFooter({
  supportEmail,
  supportPhone,
}: {
  supportEmail?: string | null;
  supportPhone?: string | null;
} = {}) {
  return (
    <footer className="border-t border-[color:var(--outline)]/25 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 text-sm text-[color:var(--muted)] sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
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
        <div className="space-y-1 text-xs sm:text-right">
          {supportPhone ? <p>Telefon: {supportPhone}</p> : null}
          {supportEmail ? <p>{supportEmail}</p> : null}
          <p>Ticketly — billettplattform</p>
        </div>
      </div>
    </footer>
  );
}
