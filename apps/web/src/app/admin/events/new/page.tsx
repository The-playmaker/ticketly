import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CreateEventWizard } from "@/components/admin/create-event-wizard";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { CreateEventOrgPicker } from "@/components/admin/create-event-org-picker";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const session = await auth();
  const scope = await resolveOrgScopeForUser(session!.user.id, session!.user.globalRole);

  if (scope.mode === "none") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Nytt arrangement</h1>
        <NoOrganizationPanel showCreateCta={scope.isPlatformAdmin} />
      </div>
    );
  }

  // SUPER_ADMIN in global mode: pick which org to create under
  if (scope.isPlatformAdmin && (scope.mode === "global" || !scope.organizationId)) {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultServiceFee: true, defaultCurrency: true },
    });
    if (orgs.length === 0) {
      return (
        <div className="mx-auto max-w-2xl space-y-6">
          <h1 className="text-2xl font-semibold tracking-tight">Nytt arrangement</h1>
          <NoOrganizationPanel showCreateCta />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nytt arrangement</h1>
          <p className="text-sm text-[color:var(--muted)]">
            Velg organisasjon, deretter opprett arrangement
          </p>
        </div>
        <CreateEventOrgPicker organizations={orgs} />
      </div>
    );
  }

  const orgId = scope.organizationId!;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nytt arrangement</h1>
        <p className="text-sm text-[color:var(--muted)]">
          Opprett og åpne salg på under 5 minutter · {org.name}
        </p>
      </div>
      <CreateEventWizard
        organizationId={orgId}
        defaultServiceFee={org.defaultServiceFee}
        currency={org.defaultCurrency}
      />
    </div>
  );
}
