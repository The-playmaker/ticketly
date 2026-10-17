import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canScanTickets } from "@/lib/auth/rbac";
import { filterEventsByAssignment } from "@/lib/auth/event-access";
import { ScannerClient } from "@/components/scan/scanner-client";

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
  const selected = sp.event
    ? accessible.find((e) => e.id === sp.event || e.slug === sp.event)
    : accessible[0];

  if (!selected) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl">Ingen arrangementer</h1>
          <p className="mt-2 text-zinc-400">Du har ikke scanner-tilgang til noen events.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
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
