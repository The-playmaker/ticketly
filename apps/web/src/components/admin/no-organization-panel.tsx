import Link from "next/link";

/**
 * Prominent empty state for SUPER_ADMIN (and optional fallback) when no org is attached.
 */
export function NoOrganizationPanel({
  showCreateCta,
  createHref = "/admin/platform/organizations/new",
}: {
  showCreateCta: boolean;
  createHref?: string;
}) {
  return (
    <section className="rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--surface-container)] p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-foreground">Ingen organisasjon tilknyttet</h2>
      <p className="mt-2 max-w-xl text-sm text-[color:var(--muted)]">
        Du må opprette en organisasjon før du kan administrere arrangementer, team og
        selgerinformasjon.
      </p>
      {showCreateCta ? (
        <Link
          href={createHref}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-md bg-[color:var(--accent)] px-6 text-base font-semibold text-[color:var(--accent-foreground)] hover:brightness-110"
          data-testid="create-organization-cta"
        >
          Opprett organisasjon
        </Link>
      ) : (
        <p className="mt-4 text-sm text-[color:var(--muted)]">
          Be en plattformadministrator om å legge deg til i en organisasjon.
        </p>
      )}
    </section>
  );
}
