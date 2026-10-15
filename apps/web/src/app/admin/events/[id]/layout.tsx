import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { canManageEvents, assertAuthorized } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { EventAdminNav } from "@/components/admin/event-admin-nav";
import { Badge } from "@/components/ui/badge";

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function EventAdminLayout({ children, params }: Props) {
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
    assertAuthorized(
      canManageEvents(user, event.organizationId) || user.globalRole === "SUPER_ADMIN"
    );
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
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
        </p>
      </div>
      <EventAdminNav eventId={id} />
      {children}
    </div>
  );
}
