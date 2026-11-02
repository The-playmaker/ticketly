import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { PromoService } from "@/services/promo-service";
import { PromoterManager } from "@/components/admin/promoter-manager";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { SelectOrganizationPrompt } from "@/components/admin/select-organization-prompt";

export const dynamic = "force-dynamic";

export default async function AdminPromotersPage() {
  const session = await auth();
  const scope = await resolveOrgScopeForUser(session!.user.id, session!.user.globalRole);

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
  const [promoters, events] = await Promise.all([
    PromoService.salesReport({ organizationId: orgId, kind: "TRACKING" }),
    prisma.event.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, slug: true },
      orderBy: { startsAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Promotører</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Gi hver promotør en unik delingslenke. Salg tilskrives automatisk når kjøperen kommer via
          lenken (eller skriver inn koden). Refusjoner trekkes fra netto.
        </p>
      </div>
      <PromoterManager initialPromoters={promoters} events={events} />
    </div>
  );
}
