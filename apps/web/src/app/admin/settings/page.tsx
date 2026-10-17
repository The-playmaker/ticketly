import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { nexiConfigHealth, resolvePaymentProviderType } from "@/lib/payments";
import { canManageOrganization, isSuperAdmin } from "@/lib/auth/rbac";
import { SellerSettingsForm } from "@/components/admin/seller-settings-form";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { SelectOrganizationPrompt } from "@/components/admin/select-organization-prompt";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const session = await auth();
  const user = {
    id: session!.user.id,
    email: session!.user.email!,
    globalRole: session!.user.globalRole,
    isActive: session!.user.isActive !== false,
    memberships: session!.user.memberships,
  };
  const scope = await resolveOrgScopeForUser(user.id, user.globalRole);
  const orgId = scope.organizationId;
  const org = orgId
    ? await prisma.organization.findUnique({ where: { id: orgId } })
    : null;

  const canEdit =
    !!org && (canManageOrganization(user, org.id) || isSuperAdmin(user));

  const provider = (() => {
    try {
      return resolvePaymentProviderType();
    } catch (e) {
      return e instanceof Error ? e.message : "error";
    }
  })();
  const nexi = nexiConfigHealth();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Innstillinger</h1>
          <p className="text-sm text-[color:var(--muted)]">
            Organisasjon, selgerfelter og betaling
          </p>
        </div>
        {canEdit ? (
          <Link
            href="/admin/settings/team"
            className="rounded-md border border-[color:var(--outline)]/40 px-3 py-1.5 text-xs hover:bg-[color:var(--surface-high)]"
          >
            Team
          </Link>
        ) : null}
      </div>

      {scope.mode === "none" && scope.isPlatformAdmin ? (
        <NoOrganizationPanel showCreateCta />
      ) : scope.mode === "none" ? (
        <NoOrganizationPanel showCreateCta={false} />
      ) : scope.mode === "global" || !org ? (
        <SelectOrganizationPrompt
          organizations={scope.organizations}
          title="Velg organisasjon for innstillinger"
          description="Selgerfelter og org-innstillinger gjelder én organisasjon om gangen. Velg i velgeren i sidepanelet, eller her."
        />
      ) : canEdit ? (
        <SellerSettingsForm org={org} />
      ) : (
        <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm">
          <h2 className="font-medium">Seller of record</h2>
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Juridisk navn</dt>
              <dd>{org.legalName ?? org.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Org.nr</dt>
              <dd>{org.organizationNumber ?? "—"}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm">
        <h2 className="font-medium">Betaling</h2>
        <dl className="mt-3 space-y-2">
          <div className="flex justify-between gap-4">
            <dt className="text-[color:var(--muted)]">PAYMENT_PROVIDER</dt>
            <dd className="font-mono text-xs">{String(provider)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[color:var(--muted)]">Nexi Checkout</dt>
            <dd>
              {nexi.status === "operational" ? "Operational" : "Configuration Error"}
              <span className="ml-2 text-xs text-zinc-400">({nexi.environment})</span>
            </dd>
          </div>
        </dl>
        {nexi.message ? <p className="mt-2 text-xs text-[color:var(--accent)]">{nexi.message}</p> : null}
        {isSuperAdmin(user) ? (
          <p className="mt-3 text-xs text-[color:var(--muted)]">
            <Link
              href="/admin/platform/payments/diagnostics"
              className="text-[color:var(--accent)] hover:underline"
            >
              Åpne betalingsdiagnostikk
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
