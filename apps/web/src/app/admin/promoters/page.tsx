import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { requireAdminPageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isMissingPromoMigrationError } from "@/lib/promo-migration";
import { PromoService } from "@/services/promo-service";
import { PromoterManager } from "@/components/admin/promoter-manager";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { SelectOrganizationPrompt } from "@/components/admin/select-organization-prompt";

export const dynamic = "force-dynamic";

function MigrationMissingNotice() {
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      <p className="font-medium">Database-migrasjon mangler</p>
      <p className="mt-1 text-[color:var(--muted)]">
        Produksjonsdatabasen mangler kolonner for promotørsporing (
        <code className="text-xs">PromoCode.label</code> /{" "}
        <code className="text-xs">kind</code>). Kjør{" "}
        <code className="text-xs">npm run db:migrate</code> (
        <code className="text-xs">prisma migrate deploy</code>) før promotører kan brukes.
      </p>
    </div>
  );
}

export default async function AdminPromotersPage() {
  const user = await requireAdminPageSession("/admin/promoters");
  const scope = await resolveOrgScopeForUser(user.id, user.globalRole);

  if (scope.mode === "none") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Promotører</h1>
        <NoOrganizationPanel showCreateCta={scope.isPlatformAdmin} />
      </div>
    );
  }

  if (scope.mode === "global" || !scope.organizationId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Promotører</h1>
        <SelectOrganizationPrompt
          organizations={scope.organizations}
          title="Velg organisasjon for promotører"
          description="Promotørsporing er organisasjonsbundet. Velg en organisasjon for å administrere lenker og salg."
        />
      </div>
    );
  }

  const orgId = scope.organizationId;
  let promoters;
  let events;
  try {
    [promoters, events] = await Promise.all([
      PromoService.salesReport({ organizationId: orgId, kind: "TRACKING" }),
      prisma.event.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, slug: true },
        orderBy: { startsAt: "desc" },
        take: 100,
      }),
    ]);
  } catch (e) {
    if (isMissingPromoMigrationError(e)) {
      return (
        <div className="space-y-6">
          <h1 className="text-2xl font-semibold">Promotører</h1>
          <MigrationMissingNotice />
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Promotører</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Gi hver promotør en unik delingslenke for å bevise salg. Sporing gir ingen rabatt —
          salg tilskrives når kjøperen kommer via lenken (eller skriver inn koden). Refusjoner
          trekkes fra netto. Ekte rabattkoder opprettes under Kampanjer.
        </p>
      </div>
      <PromoterManager initialPromoters={promoters} events={events} />
    </div>
  );
}
