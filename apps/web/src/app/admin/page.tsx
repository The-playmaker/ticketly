import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EventService } from "@/services/event-service";
import { formatMoney } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesCharts } from "@/components/admin/sales-charts";

async function getOrgId(userId: string, globalRole: string) {
  if (globalRole === "SUPER_ADMIN") {
    return (await prisma.organization.findFirst({ where: { slug: "titan-events" } }))?.id;
  }
  return (
    await prisma.organizationMember.findFirst({ where: { userId, isActive: true } })
  )?.organizationId;
}

export default async function AdminDashboardPage() {
  const session = await auth();
  const orgId = await getOrgId(session!.user.id, session!.user.globalRole);
  if (!orgId) {
    return <p>Ingen organisasjon tilknyttet.</p>;
  }

  const stats = await EventService.getOrgDashboardStats(orgId);
  const events = await prisma.event.findMany({
    where: { organizationId: orgId },
    orderBy: { startsAt: "asc" },
    take: 10,
  });

  const paidOrders = await prisma.order.findMany({
    where: { organizationId: orgId, paymentStatus: "PAID" },
    select: { total: true, paidAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const byDayMap = new Map<string, number>();
  for (const o of paidOrders) {
    const d = (o.paidAt ?? o.createdAt).toISOString().slice(0, 10);
    byDayMap.set(d, (byDayMap.get(d) ?? 0) + o.total);
  }
  const salesPerDay = [...byDayMap.entries()].map(([date, amount]) => ({ date, amount }));

  const cards = [
    { label: "Omsetning i dag", value: formatMoney(stats.revenueToday) },
    { label: "Omsetning totalt", value: formatMoney(stats.revenueTotal) },
    { label: "Solgte billetter", value: String(stats.ticketsSold) },
    { label: "Innsjekket", value: String(stats.checkedIn) },
    { label: "Kapasitet", value: `${stats.percentSold}% av ${stats.capacity}` },
    { label: "Snitt ordre", value: formatMoney(stats.averageOrderValue) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500">Live salg og innsjekking for organisasjonen</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="border-zinc-200 bg-white text-zinc-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SalesCharts salesPerDay={salesPerDay} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Arrangementer</h2>
          <div className="flex gap-3 text-sm">
            <Link href="/admin/events/new" className="font-medium text-zinc-900 hover:underline">
              Nytt arrangement
            </Link>
            <Link href="/admin/events" className="text-amber-700 hover:underline">
              Se alle
            </Link>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100">
                  <td className="px-4 py-3 font-medium">{e.name}</td>
                  <td className="px-4 py-3">{e.status}</td>
                  <td className="px-4 py-3 text-zinc-500">
                    {e.startsAt.toLocaleString("nb-NO")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/events/${e.id}`} className="text-amber-700 hover:underline">
                      Åpne
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
