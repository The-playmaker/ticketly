import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { canManageEvents, assertAuthorized } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { EventOpsPanel } from "@/components/admin/event-ops-panel";
import { Badge } from "@/components/ui/badge";

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3456";
  const publicUrl = `${appUrl.replace(/\/$/, "")}/events/${event.slug}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="muted">{event.status}</Badge>
            {event.salesPausedAt ? <Badge variant="warning">PAUSED</Badge> : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
          <p className="text-sm text-zinc-500">
            <Link href="/admin/events" className="hover:underline">
              Arrangementer
            </Link>
            {" · "}
            Live oppdatering hvert 8. sekund
          </p>
        </div>
      </div>

      <EventOpsPanel eventId={event.id} slug={event.slug} publicUrl={publicUrl} />
    </div>
  );
}
