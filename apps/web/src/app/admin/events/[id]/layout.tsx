import { notFound } from "next/navigation";
import Link from "next/link";
import { canManageEvents, assertAuthorized, isSuperAdmin } from "@/lib/auth/rbac";
import { requireAdminPageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { EventAdminNav } from "@/components/admin/event-admin-nav";
import { Badge } from "@/components/ui/badge";

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function EventAdminLayout({ children, params }: Props) {
  const { id } = await params;
  const user = await requireAdminPageSession(`/admin/events/${id}`);
  const event = await prisma.event.findUnique({
    where: { id },
    include: { organization: { select: { name: true } } },
  });
  if (!event) notFound();

  try {
    assertAuthorized(canManageEvents(user, event.organizationId) || isSuperAdmin(user));
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
        <p className="text-sm text-[color:var(--muted)]">
          <Link href="/admin/events" className="hover:underline">
            Arrangementer
          </Link>
          {isSuperAdmin(user) ? (
            <span>
              {" "}
              · {event.organization.name}
            </span>
          ) : null}
        </p>
      </div>
      <EventAdminNav eventId={id} />
      {children}
    </div>
  );
}
