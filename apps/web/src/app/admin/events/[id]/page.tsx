import Image from "next/image";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EventOpsPanel } from "@/components/admin/event-ops-panel";
import { EditEventLink } from "@/components/admin/edit-event-link";
import { withCoverCacheBust } from "@/lib/media/cover-url";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function EventAdminDashboard({ params }: Props) {
  const { id } = await params;
  await auth();
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3456";
  const publicUrl = `${appUrl.replace(/\/$/, "")}/events/${event.slug}`;
  const cover = withCoverCacheBust(event.coverImageUrl, event.updatedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {cover ? (
            <div className="relative mb-3 aspect-[21/9] max-w-xl overflow-hidden rounded-lg border border-[color:var(--outline)]/30">
              <Image
                src={cover}
                alt=""
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 36rem"
              />
            </div>
          ) : null}
          <p className="text-sm text-[color:var(--muted)]">Live oppdatering hvert 8. sekund</p>
        </div>
        <EditEventLink eventId={event.id} />
      </div>
      <EventOpsPanel eventId={event.id} slug={event.slug} publicUrl={publicUrl} />
    </div>
  );
}
