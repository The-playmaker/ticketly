import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatEventDateTime } from "@/lib/time";

async function orgIdFor(userId: string, globalRole: string) {
  if (globalRole === "SUPER_ADMIN") {
    return (await prisma.organization.findFirst({ where: { slug: "titan-events" } }))?.id;
  }
  return (await prisma.organizationMember.findFirst({ where: { userId, isActive: true } }))
    ?.organizationId;
}

export default async function AdminEventsPage() {
  const session = await auth();
  const orgId = await orgIdFor(session!.user.id, session!.user.globalRole);
  const events = orgId
    ? await prisma.event.findMany({
        where: { organizationId: orgId },
        include: { ticketTypes: true, venue: true },
        orderBy: { startsAt: "desc" },
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Arrangementer</h1>
        <Link
          href="/admin/events/new"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Nytt arrangement
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-4 py-3">Navn</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Solgt</th>
              <th className="px-4 py-3">Når</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const sold = e.ticketTypes.reduce((s, t) => s + t.quantitySold, 0);
              return (
                <tr key={e.id} className="border-t border-zinc-100">
                  <td className="px-4 py-3 font-medium">{e.name}</td>
                  <td className="px-4 py-3">{e.status}</td>
                  <td className="px-4 py-3">
                    {sold} / {e.capacity}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {formatEventDateTime(e.startsAt, e.timezone)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link className="text-amber-700 hover:underline" href={`/admin/events/${e.id}`}>
                      Dashboard
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
