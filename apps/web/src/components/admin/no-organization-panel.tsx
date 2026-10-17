import Link from "next/link";

/**
 * Empty state when zero organizations exist (platform) or user has no membership.
 * For SUPER_ADMIN this is onboarding — not an access denial for platform tools.
 */
export function NoOrganizationPanel({
  showCreateCta,
  createHref = "/admin/platform/organizations/new",
  title,
  description,
}: {
  showCreateCta: boolean;
  createHref?: string;
  title?: string;
  description?: string;
}) {
  const heading = title ?? (showCreateCta ? "Ingen organisasjoner ennå" : "Ingen organisasjon tilknyttet");
  const body =
    description ??
    (showCreateCta
      ? "Opprett den første organisasjonen for å administrere arrangementer, team og selgerinformasjon. Plattformverktøy (brukere, readiness, organisasjonsliste) er fortsatt tilgjengelige."
      : "Du må tilhøre en organisasjon før du kan bruke denne delen av admin.");

  return (
    <section className="rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--surface-container)] p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
      <p className="mt-2 max-w-xl text-sm text-[color:var(--muted)]">{body}</p>
      {showCreateCta ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={createHref}
            className="inline-flex h-12 items-center justify-center rounded-md bg-[color:var(--accent)] px-6 text-base font-semibold text-[color:var(--accent-foreground)] hover:brightness-110"
            data-testid="create-organization-cta"
          >
            Opprett organisasjon
          </Link>
          <Link
            href="/admin/platform/organizations"
            className="inline-flex h-12 items-center justify-center rounded-md border border-[color:var(--outline)]/40 px-4 text-sm font-medium hover:bg-[color:var(--surface-high)]"
          >
            Plattformorganisasjoner
          </Link>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[color:var(--muted)]">
          Be en plattformadministrator om å legge deg til i en organisasjon.
        </p>
      )}
    </section>
  );
}
