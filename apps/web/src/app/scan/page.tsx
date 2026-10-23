import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canScanTickets } from "@/lib/auth/rbac";
import { filterEventsByAssignment, isDoorStaffOnly } from "@/lib/auth/event-access";
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
      status: { in: ["PUBLISHED", "SOLD_OUT", "COMPLETED"] },
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
      <div className="min-h-dvh bg-zinc-950 text-zinc-100">
        {chrome}
        <div className="flex items-center justify-center p-6 text-center">
          <div>
            <h1 className="font-display text-2xl">Ingen arrangementer</h1>
            <p className="mt-2 text-zinc-400">
              Du har ikke scanner-tilgang til noen events.
              {doorOnly
                ? " Be en administrator om å tildele eventtilgang."
                : null}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      {chrome}
      {accessible.length > 1 ? (
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {accessible.map((e) => (
              <Link
                key={e.id}
                href={`/scan?event=${e.id}`}
                className={`rounded-md px-2 py-1 text-xs ${
                  e.id === selected.id ? "bg-amber-500 text-zinc-950" : "bg-zinc-800 text-zinc-300"
                }`}
              >
                {e.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <ScannerClient eventId={selected.id} eventName={selected.name} />
    </div>
  );
}
