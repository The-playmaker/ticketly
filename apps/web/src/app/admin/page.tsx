import { Suspense } from "react";
import Link from "next/link";
import { requireAdminPageSession } from "@/lib/auth/session";
import { formatMoney } from "@/lib/utils";
import { SalesCharts } from "@/components/admin/sales-charts";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { getCachedDashboardBundle } from "@/lib/cache/cached-reads";
import { PageHeader } from "@/components/ui/page-header";
import { KpiStat } from "@/components/ui/kpi-stat";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, statusTone } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import {
  AdminKpiSkeleton,
  AdminTableSkeleton,
} from "@/components/admin/admin-loading-skeleton";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const user = await requireAdminPageSession();
  const scope = await resolveOrgScopeForUser(user.id, user.globalRole);

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

  const scopeLabel =
    scope.mode === "global"
      ? "Alle organisasjoner"
      : (scope.organizations.find((o) => o.id === scope.organizationId)?.name ?? "Organisasjon");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Live transaksjonsmonitor"
        title="Oversikt & salgsytelse"
        description={`Salg og innsjekking · ${scopeLabel} · oppdateres hvert ~20s`}
        actions={
          <Button asChild size="sm">
            <Link href="/admin/events/new">+ Opprett arrangement</Link>
          </Button>
        }
      />

      <Suspense fallback={<DashboardKpisFallback />}>
        <DashboardBody
          organizationId={scope.organizationId}
          showOrgColumn={scope.mode === "global"}
        />
      </Suspense>
    </div>
  );
}

function DashboardKpisFallback() {
  return (
    <div className="space-y-8">
      <AdminKpiSkeleton count={4} />
      <AdminKpiSkeleton count={8} />
      <SkeletonChart />
      <AdminTableSkeleton rows={5} />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="rounded-lg border border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] p-4">
      <div className="mb-3 h-4 w-32 animate-pulse rounded bg-[color:var(--surface-high)]" />
      <div className="h-48 animate-pulse rounded bg-[color:var(--surface-high)]" />
    </div>
  );
}

async function DashboardBody({
  organizationId,
  showOrgColumn,
}: {
  organizationId: string | null;
  showOrgColumn: boolean;
}) {
  const { stats, events, salesPerDay } = await getCachedDashboardBundle(organizationId);

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
    <>
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
            <ul className="space-y-3 md:hidden">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{e.name}</p>
                      {showOrgColumn ? (
                        <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                          {e.organization.name}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-[color:var(--muted)]">
                        {new Date(e.startsAt).toLocaleString("nb-NO")}
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

            <div className="tl-table-wrap hidden md:block">
              <table>
                <thead>
                  <tr>
                    <th>Navn</th>
                    {showOrgColumn ? <th>Organisasjon</th> : null}
                    <th>Status</th>
                    <th>Start</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="font-medium text-foreground">{e.name}</td>
                      {showOrgColumn ? (
                        <td className="text-[color:var(--muted)]">{e.organization.name}</td>
                      ) : null}
                      <td>
                        <StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill>
                      </td>
                      <td className="whitespace-nowrap text-[color:var(--muted)]">
                        {new Date(e.startsAt).toLocaleString("nb-NO")}
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
    </>
  );
}
