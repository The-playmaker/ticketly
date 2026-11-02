import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/utils";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { organizationIdWhere } from "@/lib/admin/org-context";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, statusTone } from "@/components/ui/status-pill";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
    return (
      <EmptyState
        title="Ingen organisasjon"
        description="Kontoen din er ikke tilknyttet en organisasjon ennå."
      />
    );
  }

  if (scope.mode === "none" && scope.isPlatformAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Ordrer / Support" />
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
      <PageHeader
        title="Ordrer / Support"
        description={
          <>
            Søk på ordrenummer, billett-ID, e-post, telefon, navn, arrangement eller
            betalingsreferanse.
            {scope.mode === "global" ? " · Alle organisasjoner" : ""}
          </>
        }
      />

      <form className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Søk…"
          className="min-w-0 flex-1 sm:min-w-[240px]"
          aria-label="Søk i ordrer"
        />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1 sm:flex-none">
            Søk
          </Button>
          {q ? (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href="/admin/orders">Nullstill</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {orders.length === 0 ? (
        <EmptyState
          title={q ? "Ingen treff" : "Ingen ordrer"}
          description={
            q
              ? "Prøv et annet søkeord eller nullstill filteret."
              : "Ordrer dukker opp her når kunder fullfører kjøp."
          }
        />
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {orders.map((o) => {
              const pay = o.payments[0];
              return (
                <li
                  key={o.id}
                  className="rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/orders/${o.orderNumber}`}
                        className="font-mono text-sm font-medium text-[color:var(--accent)]"
                      >
                        {o.orderNumber}
                      </Link>
                      <p className="mt-1 truncate text-sm text-foreground">
                        {o.customerFirstName} {o.customerLastName}
                      </p>
                      <p className="truncate text-xs text-[color:var(--muted)]">
                        {o.customerEmail}
                      </p>
                      <p className="mt-1 text-xs text-[color:var(--muted)]">{o.event.name}</p>
                      {showOrg ? (
                        <p className="text-xs text-[color:var(--muted)]">{o.organization.name}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatMoney(o.total, o.currency)}
                      </p>
                      <div className="mt-1.5 flex flex-col items-end gap-1">
                        <StatusPill tone={statusTone(o.paymentStatus)}>
                          {o.paymentStatus}
                        </StatusPill>
                      </div>
                    </div>
                  </div>
                  {pay?.provider ? (
                    <p className="mt-2 text-[10px] text-[color:var(--muted)]">
                      {pay.provider}
                      {pay.providerPaymentId ? ` · ${maskRef(pay.providerPaymentId)}` : ""}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="tl-table-wrap hidden lg:block">
            <table>
              <thead>
                <tr>
                  <th>Ordrenr</th>
                  <th>Kunde</th>
                  {showOrg ? <th>Organisasjon</th> : null}
                  <th>Event</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Totalt</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const pay = o.payments[0];
                  return (
                    <tr key={o.id}>
                      <td className="font-mono text-xs">
                        <Link
                          className="text-[color:var(--accent)] underline-offset-2 hover:underline"
                          href={`/admin/orders/${o.orderNumber}`}
                        >
                          {o.orderNumber}
                        </Link>
                      </td>
                      <td>
                        {o.customerFirstName} {o.customerLastName}
                        <div className="text-xs text-[color:var(--muted)]">{o.customerEmail}</div>
                      </td>
                      {showOrg ? (
                        <td className="text-[color:var(--muted)]">{o.organization.name}</td>
                      ) : null}
                      <td>{o.event.name}</td>
                      <td className="text-xs">
                        {pay?.provider ?? "—"}
                        {pay?.providerPaymentId ? (
                          <div className="font-mono text-[10px] text-[color:var(--muted)]">
                            {maskRef(pay.providerPaymentId)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <StatusPill tone={statusTone(o.paymentStatus)}>
                            {o.paymentStatus}
                          </StatusPill>
                          <StatusPill tone={statusTone(o.orderStatus)}>
                            {o.orderStatus}
                          </StatusPill>
                        </div>
                      </td>
                      <td className="tabular-nums">{formatMoney(o.total, o.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
