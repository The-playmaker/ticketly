import Link from "next/link";
import { OrgContextSwitcher, type OrgSwitcherOption } from "@/components/admin/org-context-switcher";

/**
 * Soft prompt for SUPER_ADMIN when an org-specific tool needs a selected organization.
 * Not a hard access denial — platform access remains.
 */
export function SelectOrganizationPrompt({
  organizations,
  title = "Velg organisasjon",
  description = "Denne siden gjelder én organisasjon. Velg kontekst i velgeren, eller åpne plattformorganisasjoner.",
  showCreateCta = true,
}: {
  organizations: OrgSwitcherOption[];
  title?: string;
  description?: string;
  showCreateCta?: boolean;
}) {
  return (
    <section
      className="rounded-xl border border-[color:var(--outline)]/40 bg-[color:var(--surface-container)] p-6 sm:p-8"
      data-testid="select-organization-prompt"
    >
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-xl text-sm text-[color:var(--muted)]">{description}</p>
      {organizations.length > 0 ? (
        <div className="mt-5">
          <OrgContextSwitcher
            organizations={organizations}
            selectedOrganizationId={null}
            mode="global"
            allowGlobal={false}
          />
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/admin/platform/organizations"
          className="inline-flex h-10 items-center rounded-md border border-[color:var(--outline)]/40 px-4 text-sm font-medium hover:bg-[color:var(--surface-high)]"
        >
          Alle organisasjoner
        </Link>
        {showCreateCta ? (
          <Link
            href="/admin/platform/organizations/new"
            className="inline-flex h-10 items-center rounded-md bg-[color:var(--accent)] px-4 text-sm font-semibold text-[color:var(--accent-foreground)]"
            data-testid="create-organization-cta"
          >
            Opprett organisasjon
          </Link>
        ) : null}
      </div>
    </section>
  );
}
