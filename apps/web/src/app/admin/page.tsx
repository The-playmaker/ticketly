import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EventService } from "@/services/event-service";
import { formatMoney } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesCharts } from "@/components/admin/sales-charts";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { organizationIdWhere } from "@/lib/admin/org-context";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await auth();
  const scope = await resolveOrgScopeForUser(session!.user.id, session!.user.globalRole);

  if (scope.mode === "none" && !scope.isPlatformAdmin) {
    return <p>Ingen organisasjon tilknyttet.</p>;
  }

  if (scope.mode === "none" && scope.isPlatformAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Oversikt</h1>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Plattformadmin — opprett første organisasjon for å starte salg.
          </p>
        </div>
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

  const cards = [
    { label: "Brutto salg i dag", value: formatMoney(stats.revenueToday) },
    { label: "Brutto salg", value: formatMoney(stats.grossSales ?? stats.revenueTotal) },
    { label: "Refundert beløp", value: formatMoney(stats.successfulRefundAmount ?? stats.refundedAmount) },
    { label: "Netto omsetning", value: formatMoney(stats.netRevenue ?? stats.revenueTotal - stats.refundedAmount) },
    { label: "Solgt / aktive billetter", value: String(stats.ticketsSold) },
    { label: "Ordrer (betalt)", value: String(stats.orderCount) },
    {
      label: "Konvertering",
      value:
        stats.conversionPercent == null
          ? "Ikke tilgjengelig"
          : `${stats.conversionPercent}%`,
    },
    { label: "Reservert", value: String(stats.activeReservations) },
    { label: "Feilede betalinger", value: String(stats.failedPayments) },
    { label: "Innsjekket", value: String(stats.checkedIn) },
    { label: "Kapasitet", value: `${stats.percentSold}% av ${stats.capacity}` },
    { label: "Snitt ordre", value: formatMoney(stats.averageOrderValue) },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">
            Live transaksjonsmonitor
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Oversikt &amp; salgsytelse
          </h1>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Live salg og innsjekking · {scopeLabel}
          </p>
        </div>
        <Link
          href="/admin/events/new"
          className="rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-semibold text-[color:var(--accent-foreground)]"
        >
          + Opprett arrangement
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => (
          <Card
            key={c.label}
            className="border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]"
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SalesCharts salesPerDay={salesPerDay} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Operativ arrangementsstatus</h2>
          <Link
            href="/admin/events"
            className="text-sm text-[color:var(--accent)] hover:brightness-110"
          >
            Se alle
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[color:var(--surface-high)] text-[color:var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                {scope.mode === "global" ? (
                  <th className="px-4 py-3 font-medium">Organisasjon</th>
                ) : null}
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-[color:var(--outline)]/20">
                  <td className="px-4 py-3 font-medium">{e.name}</td>
                  {scope.mode === "global" ? (
                    <td className="px-4 py-3 text-[color:var(--muted)]">{e.organization.name}</td>
                  ) : null}
                  <td className="px-4 py-3 text-[color:var(--muted)]">{e.status}</td>
                  <td className="px-4 py-3 text-[color:var(--muted)]">
                    {e.startsAt.toLocaleString("nb-NO")}
                  </td>
                  <td className="px-4 py-3 text-right">
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
      </section>
    </div>
  );
}
