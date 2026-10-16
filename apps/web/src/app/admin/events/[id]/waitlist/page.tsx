import { notFound } from "next/navigation";
import { WaitlistService } from "@/services/waitlist-service";
import { requireEventAccess } from "@/lib/admin/org-access";
import { WaitlistPanel } from "@/components/admin/waitlist-panel";
import { prisma } from "@/lib/db";

type Props = { params: Promise<{ id: string }> };

export default async function EventWaitlistPage({ params }: Props) {
  const { id } = await params;
  let event;
  try {
    ({ event } = await requireEventAccess(id));
  } catch {
    notFound();
  }

  const full = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
  const entries = await WaitlistService.list(id);
  const waiting = await WaitlistService.countWaiting(id);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Venteliste</h2>
        <p className="text-sm text-[color:var(--muted)]">
          {full.waitlistEnabled
            ? "Venteliste er aktivert. Invitasjoner får privat kjøpslenke (standard 30 min)."
            : "Venteliste er ikke aktivert — aktiver under Innstillinger."}
        </p>
      </div>
      <WaitlistPanel
        eventId={id}
        waitingCount={waiting}
        initialEntries={entries.map((e) => ({
          id: e.id,
          email: e.email,
          name: e.name,
          phone: e.phone,
          requestedQuantity: e.requestedQuantity,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
          ticketType: e.ticketType,
        }))}
      />
    </div>
  );
}
