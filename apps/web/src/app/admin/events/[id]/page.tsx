import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EventOpsPanel } from "@/components/admin/event-ops-panel";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function EventAdminDashboard({ params }: Props) {
  const { id } = await params;
  await auth();
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3456";
  const publicUrl = `${appUrl.replace(/\/$/, "")}/events/${event.slug}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[color:var(--muted)]">Live oppdatering hvert 8. sekund</p>
      <EventOpsPanel eventId={event.id} slug={event.slug} publicUrl={publicUrl} />
    </div>
  );
}
