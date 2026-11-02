import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canScanTickets } from "@/lib/auth/rbac";
import { filterEventsByAssignment, isDoorStaffOnly } from "@/lib/auth/event-access";
import { SCANNABLE_EVENT_STATUSES } from "@/lib/auth/scannable-events";
import { ScannerClient } from "@/components/scan/scanner-client";
import { DoorStaffChrome } from "@/components/scan/door-staff-chrome";

type Props = { searchParams: Promise<{ event?: string }> };

export default async function ScanPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id || session.user.isActive === false) {
    redirect("/login?callbackUrl=/scan");
  }

  const sp = await searchParams;
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      memberships: { where: { isActive: true } },
      eventAssignments: { select: { eventId: true } },
    },
  });
  if (!dbUser?.isActive) redirect("/login?callbackUrl=/scan");

  const user = {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    globalRole: dbUser.globalRole,
    isActive: dbUser.isActive,
    memberships: dbUser.memberships,
    eventAssignments: dbUser.eventAssignments,
  };

  const doorOnly = isDoorStaffOnly(user);

  const events = await prisma.event.findMany({
    where: {
      // Include PAUSED: paused sales must not block ticket validation
      status: { in: SCANNABLE_EVENT_STATUSES },
      ...(user.globalRole === "SUPER_ADMIN"
        ? {}
        : { organization: { members: { some: { userId: user.id, isActive: true } } } }),
    },
    include: { organization: true },
    orderBy: { startsAt: "asc" },
    take: 50,
  });

  const scannable = events.filter((e) => canScanTickets(user, e.organizationId));
  const accessible = filterEventsByAssignment(user, scannable);

  // Auto-select when exactly one; honor ?event= when multiple / deep-link
  const selected =
    accessible.length === 1
      ? accessible[0]
      : sp.event
        ? accessible.find((e) => e.id === sp.event || e.slug === sp.event)
        : accessible[0];

  const chrome = doorOnly ? <DoorStaffChrome email={user.email} /> : null;

  if (!selected) {
    return (
      <div className="min-h-dvh bg-[color:var(--background)] text-foreground">
        {chrome}
        <div className="flex items-center justify-center p-6 text-center">
          <div>
            <h1 className="font-display text-2xl font-semibold">Ingen arrangementer</h1>
            <p className="mt-2 text-[color:var(--muted)]">
              Du har ikke scanner-tilgang til noen events.
              {doorOnly ? " Be en administrator om å tildele eventtilgang." : null}
            </p>
            {!doorOnly ? (
              <Link
                href="/admin"
                className="mt-4 inline-flex text-sm text-[color:var(--accent)] hover:underline"
              >
                Tilbake til admin
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[color:var(--background)] text-foreground">
      {chrome}
      {accessible.length > 1 ? (
        <div className="border-b border-[color:var(--outline)]/30 bg-[color:var(--surface-low)] px-3 py-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {accessible.map((e) => (
              <Link
                key={e.id}
                href={`/scan?event=${e.id}`}
                className={`shrink-0 rounded-md px-3 py-2 text-xs font-medium transition ${
                  e.id === selected.id
                    ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
                    : "bg-[color:var(--surface-high)] text-[color:var(--muted)] hover:text-foreground"
                }`}
              >
                {e.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {!doorOnly ? (
        <div className="flex justify-end border-b border-[color:var(--outline)]/20 px-3 py-1.5">
          <Link
            href="/admin"
            className="text-[11px] text-[color:var(--muted)] hover:text-foreground"
          >
            ← Admin
          </Link>
        </div>
      ) : null}
      <ScannerClient eventId={selected.id} eventName={selected.name} />
    </div>
  );
}
