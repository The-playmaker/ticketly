import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SiteHeader } from "@/components/layout/site-header";
import { TicketQrCard } from "@/components/tickets/ticket-qr-card";
import { resolveRawTicketToken } from "@/lib/tickets/token";

export default async function MyTicketsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/my/tickets");

  const tickets = await prisma.ticket.findMany({
    where: {
      OR: [
        { holderEmail: session.user.email },
        { order: { customerId: session.user.id } },
      ],
      status: { in: ["VALID", "CHECKED_IN", "TRANSFERRED"] },
    },
    include: {
      ticketType: true,
      event: { include: { venue: true } },
      order: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-display text-3xl">Mine billetter</h1>
        <div className="mt-8 space-y-6">
          {tickets.length === 0 ? (
            <p className="text-zinc-400">Du har ingen billetter ennå.</p>
          ) : (
            tickets.map((t) => {
              const raw = resolveRawTicketToken(t);
              if (!raw) return null;
              return (
                <TicketQrCard
                  key={t.id}
                  ticket={{
                    publicId: t.publicId,
                    secureToken: raw,
                    accessToken: t.order.accessToken,
                    holderName: t.holderName,
                    status: t.status,
                    ticketTypeName: t.ticketType.name,
                  }}
                  event={{
                    name: t.event.name,
                    startsAt: t.event.startsAt.toISOString(),
                    timezone: t.event.timezone,
                    venue: t.event.venue?.name ?? t.event.city ?? "",
                  }}
                  orderNumber={t.order.orderNumber}
                />
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
