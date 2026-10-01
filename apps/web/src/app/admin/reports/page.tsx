import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function orgIdFor(userId: string, globalRole: string) {
  if (globalRole === "SUPER_ADMIN") {
    return (await prisma.organization.findFirst({ where: { slug: "titan-events" } }))?.id;
  }
  return (await prisma.organizationMember.findFirst({ where: { userId, isActive: true } }))
    ?.organizationId;
}

export default async function AdminReportsPage() {
  const session = await auth();
  const orgId = await orgIdFor(session!.user.id, session!.user.globalRole);
  const events = orgId
    ? await prisma.event.findMany({ where: { organizationId: orgId }, orderBy: { startsAt: "desc" } })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rapporter</h1>
        <p className="text-sm text-zinc-500">Eksporter CSV / Excel for ordre, billetter, check-ins</p>
      </div>
      <div className="space-y-3">
        {events.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4">
            <div>
              <p className="font-medium">{e.name}</p>
              <p className="text-xs text-zinc-500">{e.status}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link className="rounded-md bg-zinc-900 px-3 py-1.5 text-white" href={`/api/admin/reports?eventId=${e.id}&type=orders&format=csv`}>
                Ordrer CSV
              </Link>
              <Link className="rounded-md bg-zinc-900 px-3 py-1.5 text-white" href={`/api/admin/reports?eventId=${e.id}&type=tickets&format=csv`}>
                Billetter CSV
              </Link>
              <Link className="rounded-md bg-zinc-900 px-3 py-1.5 text-white" href={`/api/admin/reports?eventId=${e.id}&type=checkins&format=csv`}>
                Check-ins CSV
              </Link>
              <Link className="rounded-md border border-zinc-300 px-3 py-1.5" href={`/api/admin/reports?eventId=${e.id}&type=orders&format=xlsx`}>
                Excel
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
