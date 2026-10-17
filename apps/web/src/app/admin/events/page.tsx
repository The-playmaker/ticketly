import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatEventDateTime } from "@/lib/time";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { organizationIdWhere } from "@/lib/admin/org-context";
import { filterEventsByAssignment, isDoorStaffOnly } from "@/lib/auth/event-access";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  const session = await auth();
  const baseUser = {
    id: session!.user.id,
    email: session!.user.email!,
    globalRole: session!.user.globalRole,
    isActive: session!.user.isActive !== false,
    memberships: session!.user.memberships,
  };
  const scope = await resolveOrgScopeForUser(baseUser.id, baseUser.globalRole);
  const doorOnly = isDoorStaffOnly(baseUser);

  if (scope.mode === "none" && !scope.isPlatformAdmin) {
    return <p className="text-sm text-[color:var(--muted)]">Ingen organisasjon tilknyttet.</p>;
  }

  if (scope.mode === "none" && scope.isPlatformAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Arrangementer</h1>
        <NoOrganizationPanel showCreateCta />
      </div>
    );
  }

  const orgFilter = organizationIdWhere(scope.organizationId);
  let events = await prisma.event.findMany({
    where: orgFilter,
    include: {
      ticketTypes: true,
      venue: true,
      organization: { select: { id: true, name: true } },
    },
    orderBy: { startsAt: "desc" },
  });

  if (!scope.isPlatformAdmin) {
    const eventAssignments = await prisma.eventAssignment.findMany({
      where: { userId: baseUser.id },
      select: { eventId: true },
    });
    events = filterEventsByAssignment({ ...baseUser, eventAssignments }, events);
  }

  const showOrgColumn = scope.mode === "global" || scope.isPlatformAdmin;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Arrangementer</h1>
          {scope.mode === "global" ? (
            <p className="text-sm text-[color:var(--muted)]">Alle organisasjoner</p>
          ) : null}
        </div>
        {!doorOnly ? (
          <Link
            href="/admin/events/new"
            className="rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-semibold text-[color:var(--accent-foreground)]"
          >
            Nytt arrangement
          </Link>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--surface-high)] text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">Navn</th>
              {showOrgColumn ? <th className="px-4 py-3">Organisasjon</th> : null}
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Solgt</th>
              <th className="px-4 py-3">Når</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td
                  colSpan={showOrgColumn ? 6 : 5}
                  className="px-4 py-8 text-center text-[color:var(--muted)]"
                >
                  Ingen arrangementer
                </td>
              </tr>
            ) : (
              events.map((e) => {
                const sold = e.ticketTypes.reduce((s, t) => s + t.quantitySold, 0);
                return (
                  <tr key={e.id} className="border-t border-[color:var(--outline)]/20">
                    <td className="px-4 py-3 font-medium">{e.name}</td>
                    {showOrgColumn ? (
                      <td className="px-4 py-3 text-[color:var(--muted)]">{e.organization.name}</td>
                    ) : null}
                    <td className="px-4 py-3">{e.status}</td>
                    <td className="px-4 py-3">
                      {sold} / {e.capacity}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--muted)]">
                      {formatEventDateTime(e.startsAt, e.timezone)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        className="text-[color:var(--accent)] hover:underline"
                        href={`/admin/events/${e.id}`}
                      >
                        Dashboard
                      </Link>
                    </td>
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
