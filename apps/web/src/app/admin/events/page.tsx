import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatEventDateTime } from "@/lib/time";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { organizationIdWhere } from "@/lib/admin/org-context";
import { filterEventsByAssignment, isDoorStaffOnly } from "@/lib/auth/event-access";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, statusTone } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";

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
        <PageHeader title="Arrangementer" />
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
      <PageHeader
        title="Arrangementer"
        description={scope.mode === "global" ? "Alle organisasjoner" : undefined}
        actions={
          !doorOnly ? (
            <Button asChild size="sm">
              <Link href="/admin/events/new">Nytt arrangement</Link>
            </Button>
          ) : null
        }
      />

      {events.length === 0 ? (
        <EmptyState
          title="Ingen arrangementer"
          description="Opprett et arrangement for å starte billettsalg."
          action={
            !doorOnly ? (
              <Button asChild size="sm">
                <Link href="/admin/events/new">Opprett</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {events.map((e) => {
              const sold = e.ticketTypes.reduce((s, t) => s + t.quantitySold, 0);
              return (
                <li
                  key={e.id}
                  className="rounded-lg border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{e.name}</p>
                      {showOrgColumn ? (
                        <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                          {e.organization.name}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-[color:var(--muted)]">
                        {formatEventDateTime(e.startsAt, e.timezone)}
                      </p>
                      <p className="mt-1 text-xs tabular-nums text-[color:var(--muted)]">
                        Solgt {sold} / {e.capacity}
                      </p>
                    </div>
                    <StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill>
                  </div>
                  <Link
                    href={`/admin/events/${e.id}`}
                    className="mt-3 inline-flex text-sm font-medium text-[color:var(--accent)]"
                  >
                    Dashboard →
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="tl-table-wrap hidden md:block">
            <table>
              <thead>
                <tr>
                  <th>Navn</th>
                  {showOrgColumn ? <th>Organisasjon</th> : null}
                  <th>Status</th>
                  <th>Solgt</th>
                  <th>Når</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const sold = e.ticketTypes.reduce((s, t) => s + t.quantitySold, 0);
                  return (
                    <tr key={e.id}>
                      <td className="font-medium text-foreground">{e.name}</td>
                      {showOrgColumn ? (
                        <td className="text-[color:var(--muted)]">{e.organization.name}</td>
                      ) : null}
                      <td>
                        <StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill>
                      </td>
                      <td className="tabular-nums">
                        {sold} / {e.capacity}
                      </td>
                      <td className="whitespace-nowrap text-[color:var(--muted)]">
                        {formatEventDateTime(e.startsAt, e.timezone)}
                      </td>
                      <td className="text-right">
                        <Link
                          className="font-medium text-[color:var(--accent)] hover:underline"
                          href={`/admin/events/${e.id}`}
                        >
                          Dashboard
                        </Link>
                      </td>
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
