import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/utils";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { organizationIdWhere } from "@/lib/admin/org-context";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

function maskRef(ref: string | null | undefined) {
  if (!ref) return "—";
  if (ref.length <= 10) return ref;
  return `${ref.slice(0, 6)}…${ref.slice(-4)}`;
}

export default async function AdminOrdersPage({ searchParams }: Props) {
  const session = await auth();
  const scope = await resolveOrgScopeForUser(session!.user.id, session!.user.globalRole);
  const { q: rawQ } = await searchParams;
  const q = rawQ?.trim() ?? "";

  if (scope.mode === "none" && !scope.isPlatformAdmin) {
    return <p className="text-sm text-[color:var(--muted)]">Ingen organisasjon tilknyttet.</p>;
  }

  if (scope.mode === "none" && scope.isPlatformAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Ordrer / Support</h1>
        <NoOrganizationPanel showCreateCta />
      </div>
    );
  }

  const orgFilter = organizationIdWhere(scope.organizationId);
  const searchOr: Prisma.OrderWhereInput[] | undefined = q
    ? [
        { orderNumber: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
        { customerFirstName: { contains: q, mode: "insensitive" } },
        { customerLastName: { contains: q, mode: "insensitive" } },
        { event: { name: { contains: q, mode: "insensitive" } } },
        { tickets: { some: { publicId: { contains: q, mode: "insensitive" } } } },
        {
          payments: {
            some: {
              OR: [
                { providerPaymentId: { contains: q, mode: "insensitive" } },
                { providerSessionId: { contains: q, mode: "insensitive" } },
                { providerChargeId: { contains: q, mode: "insensitive" } },
              ],
            },
          },
        },
      ]
    : undefined;

  const where: Prisma.OrderWhereInput = {
    ...orgFilter,
    ...(searchOr ? { OR: searchOr } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    include: {
      event: true,
      organization: { select: { id: true, name: true } },
      tickets: true,
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: q ? 50 : 100,
  });

  const showOrg = scope.mode === "global";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ordrer / Support</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Søk på ordrenummer, billett-ID, e-post, telefon, navn, arrangement eller
          betalingsreferanse.
          {scope.mode === "global" ? " · Alle organisasjoner" : ""}
        </p>
      </div>

      <form className="flex flex-wrap gap-2" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Søk…"
          className="min-w-[240px] flex-1 rounded-md border border-[color:var(--outline)]/40 bg-[color:var(--surface-high)] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-foreground)]"
        >
          Søk
        </button>
        {q ? (
          <Link
            href="/admin/orders"
            className="rounded-md border border-[color:var(--outline)]/40 px-3 py-2 text-sm text-[color:var(--muted)]"
          >
            Nullstill
          </Link>
        ) : null}
      </form>

      <div className="overflow-hidden rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--surface-high)] text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">Ordrenr</th>
              <th className="px-4 py-3">Kunde</th>
              {showOrg ? <th className="px-4 py-3">Organisasjon</th> : null}
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Totalt</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td
                  colSpan={showOrg ? 7 : 6}
                  className="px-4 py-8 text-center text-[color:var(--muted)]"
                >
                  {q ? "Ingen treff" : "Ingen ordrer"}
                </td>
              </tr>
            ) : (
              orders.map((o) => {
                const pay = o.payments[0];
                return (
                  <tr key={o.id} className="border-t border-[color:var(--outline)]/20">
                    <td className="px-4 py-3 font-mono text-xs">
                      <a
                        className="text-[color:var(--accent)] underline"
                        href={`/admin/orders/${o.orderNumber}`}
                      >
                        {o.orderNumber}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {o.customerFirstName} {o.customerLastName}
                      <div className="text-xs text-[color:var(--muted)]">{o.customerEmail}</div>
                    </td>
                    {showOrg ? (
                      <td className="px-4 py-3 text-[color:var(--muted)]">{o.organization.name}</td>
                    ) : null}
                    <td className="px-4 py-3">{o.event.name}</td>
                    <td className="px-4 py-3 text-xs">
                      {pay?.provider ?? "—"}
                      {pay?.providerPaymentId ? (
                        <div className="font-mono text-[10px] text-[color:var(--muted)]">
                          {maskRef(pay.providerPaymentId)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {o.paymentStatus} / {o.orderStatus}
                    </td>
                    <td className="px-4 py-3">{formatMoney(o.total, o.currency)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
