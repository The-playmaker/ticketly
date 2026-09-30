import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { EventService } from "@/services/event-service";
import { canManageEvents, assertAuthorized } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/utils";
import { formatEventTime } from "@/lib/time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { params: Promise<{ id: string }> };

export default async function EventAdminDashboard({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) notFound();

  const user = {
    id: session!.user.id,
    email: session!.user.email,
    name: session!.user.name,
    globalRole: session!.user.globalRole,
    isActive: true,
    memberships: session!.user.memberships,
  };

  try {
    assertAuthorized(canManageEvents(user, event.organizationId) || user.globalRole === "SUPER_ADMIN");
  } catch {
    notFound();
  }

  const stats = await EventService.getDashboardStats(id);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">Event dashboard</p>
          <h1 className="text-2xl font-semibold">{stats.event.name}</h1>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={`/events/${stats.event.slug}`} className="text-amber-700 hover:underline">
            Offentlig side
          </Link>
          <Link href={`/scan?event=${id}`} className="text-amber-700 hover:underline">
            Åpne scanner
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Solgt", value: `${stats.sold} / ${stats.capacity}` },
          { label: "Innsjekket", value: String(stats.checkedIn) },
          { label: "Omsetning", value: formatMoney(stats.revenue) },
          { label: "Refundert", value: formatMoney(stats.refunded) },
        ].map((c) => (
          <Card key={c.label} className="border-zinc-200 bg-white text-zinc-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-500">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold">Salg per billettype</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {stats.byTicketType.map((t) => (
              <li key={t.id} className="flex justify-between border-b border-zinc-100 py-2">
                <span>{t.name}</span>
                <span className="font-medium">
                  {t.sold} / {t.total}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold">Live innsjekking</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {stats.recentCheckIns.length === 0 ? (
              <li className="text-zinc-500">Ingen innsjekkinger ennå</li>
            ) : (
              stats.recentCheckIns.map((c) => (
                <li key={c.id} className="flex justify-between border-b border-zinc-100 py-2">
                  <span>
                    {formatEventTime(c.checkedInAt, stats.event.timezone)} –{" "}
                    {c.ticket?.holderName ?? "—"} – {c.ticket?.ticketType.name}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
