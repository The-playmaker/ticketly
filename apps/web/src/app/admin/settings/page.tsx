import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOrgIdForUser } from "@/lib/admin/org-access";
import { nexiConfigHealth, resolvePaymentProviderType } from "@/lib/payments";

export default async function AdminSettingsPage() {
  const session = await auth();
  const orgId = await resolveOrgIdForUser(session!.user.id, session!.user.globalRole);
  const org = orgId
    ? await prisma.organization.findUnique({ where: { id: orgId } })
    : null;

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
      <div>
        <h1 className="text-2xl font-semibold">Innstillinger</h1>
        <p className="text-sm text-zinc-500">Organisasjon og betalingskonfigurasjon</p>
      </div>

      {!org ? (
        <p className="text-sm text-zinc-500">Ingen organisasjon tilknyttet.</p>
      ) : (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm">
          <h2 className="font-medium">Seller of record</h2>
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Juridisk navn</dt>
              <dd>{org.legalName ?? org.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Org.nr</dt>
              <dd>{org.organizationNumber ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Adresse</dt>
              <dd className="text-right">
                {[org.legalAddress, org.legalPostalCode, org.legalCity]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Kundeservice</dt>
              <dd>{org.customerServiceEmail ?? org.contactEmail ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Vilkårsversjon</dt>
              <dd>{org.termsVersion}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm">
        <h2 className="font-medium">Betaling</h2>
        <dl className="mt-3 space-y-2">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">PAYMENT_PROVIDER</dt>
            <dd className="font-mono text-xs">{String(provider)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Nexi Checkout</dt>
            <dd>
              {nexi.status === "operational" ? "Operational" : "Configuration Error"}
              <span className="ml-2 text-xs text-zinc-400">({nexi.environment})</span>
            </dd>
          </div>
        </dl>
        {nexi.message ? <p className="mt-2 text-xs text-amber-700">{nexi.message}</p> : null}
      </section>
    </div>
  );
}
