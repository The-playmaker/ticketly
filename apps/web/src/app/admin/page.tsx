import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EventService } from "@/services/event-service";
import { formatMoney } from "@/lib/utils";
import { SalesCharts } from "@/components/admin/sales-charts";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { organizationIdWhere } from "@/lib/admin/org-context";
import { PageHeader } from "@/components/ui/page-header";
import { KpiStat } from "@/components/ui/kpi-stat";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, statusTone } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await auth();
  const scope = await resolveOrgScopeForUser(session!.user.id, session!.user.globalRole);

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
        <PageHeader
          title="Oversikt"
          description="Plattformadmin — opprett første organisasjon for å starte salg."
        />
        <NoOrganizationPanel showCreateCta />
      </div>
    );
  }

  const orgFilter = organizationIdWhere(scope.organizationId);
  const [stats, events, paidOrders] = await Promise.all([
    EventService.getOrgDashboardStats(scope.organizationId),
    prisma.event.findMany({
      where: orgFilter,
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { startsAt: "asc" },
      take: 10,
    }),
    prisma.order.findMany({
      where: {
        ...orgFilter,
        OR: [
          { paidAt: { not: null } },
          { paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
        ],
      },
      select: { total: true, paidAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const byDayMap = new Map<string, number>();
  for (const o of paidOrders) {
    const d = (o.paidAt ?? o.createdAt).toISOString().slice(0, 10);
    byDayMap.set(d, (byDayMap.get(d) ?? 0) + o.total);
  }
  const salesPerDay = [...byDayMap.entries()].map(([date, amount]) => ({ date, amount }));

  const scopeLabel =
    scope.mode === "global"
      ? "Alle organisasjoner"
      : (scope.organizations.find((o) => o.id === scope.organizationId)?.name ?? "Organisasjon");

  const primaryKpis = [
    { label: "Brutto salg i dag", value: formatMoney(stats.revenueToday) },
    { label: "Netto omsetning", value: formatMoney(stats.netRevenue ?? stats.revenueTotal - stats.refundedAmount) },
    { label: "Solgt / aktive billetter", value: String(stats.ticketsSold) },
    { label: "Ordrer (betalt)", value: String(stats.orderCount) },
  ];

  const secondaryKpis = [
    { label: "Brutto salg", value: formatMoney(stats.grossSales ?? stats.revenueTotal) },
    { label: "Refundert beløp", value: formatMoney(stats.successfulRefundAmount ?? stats.refundedAmount) },
    {
      label: "Konvertering",
      value:
        stats.conversionPercent == null ? "Ikke tilgjengelig" : `${stats.conversionPercent}%`,
    },
    { label: "Reservert", value: String(stats.activeReservations) },
    { label: "Feilede betalinger", value: String(stats.failedPayments) },
    { label: "Innsjekket", value: String(stats.checkedIn) },
    { label: "Kapasitet", value: `${stats.percentSold}% av ${stats.capacity}` },
    { label: "Snitt ordre", value: formatMoney(stats.averageOrderValue) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Live transaksjonsmonitor"
        title="Oversikt & salgsytelse"
        description={`Live salg og innsjekking · ${scopeLabel}`}
        actions={
          <Button asChild size="sm">
            <Link href="/admin/events/new">+ Opprett arrangement</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {primaryKpis.map((c) => (
          <KpiStat key={c.label} label={c.label} value={c.value} />
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {secondaryKpis.map((c) => (
          <KpiStat key={c.label} label={c.label} value={c.value} className="sm:p-4" />
        ))}
      </div>

      <SalesCharts salesPerDay={salesPerDay} />

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Operativ arrangementsstatus</h2>
          <Link
            href="/admin/events"
            className="text-sm text-[color:var(--accent)] hover:brightness-110"
          >
            Se alle
          </Link>
        </div>

        {events.length === 0 ? (
          <EmptyState
            title="Ingen arrangementer"
            description="Opprett ditt første arrangement for å starte salg."
            action={
              <Button asChild size="sm">
                <Link href="/admin/events/new">Opprett arrangement</Link>
              </Button>
            }
          />
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="space-y-3 md:hidden">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{e.name}</p>
                      {scope.mode === "global" ? (
                        <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                          {e.organization.name}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-[color:var(--muted)]">
                        {e.startsAt.toLocaleString("nb-NO")}
                      </p>
                    </div>
                    <StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill>
                  </div>
                  <Link
                    href={`/admin/events/${e.id}`}
                    className="mt-3 inline-flex text-sm font-medium text-[color:var(--accent)]"
                  >
                    Åpne Event Control →
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <div className="tl-table-wrap hidden md:block">
              <table>
                <thead>
                  <tr>
                    <th>Navn</th>
                    {scope.mode === "global" ? <th>Organisasjon</th> : null}
                    <th>Status</th>
                    <th>Start</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="font-medium text-foreground">{e.name}</td>
                      {scope.mode === "global" ? (
                        <td className="text-[color:var(--muted)]">{e.organization.name}</td>
                      ) : null}
                      <td>
                        <StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill>
                      </td>
                      <td className="whitespace-nowrap text-[color:var(--muted)]">
                        {e.startsAt.toLocaleString("nb-NO")}
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/admin/events/${e.id}`}
                          className="font-medium text-[color:var(--accent)] hover:brightness-110"
                        >
                          Åpne Event Control
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
