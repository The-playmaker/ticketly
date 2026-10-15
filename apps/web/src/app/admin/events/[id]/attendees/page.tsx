import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireEventAccess } from "@/lib/admin/org-access";
import type { TicketStatus } from "@prisma/client";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
};

const FILTERS = [
  "ALL",
  "VALID",
  "CHECKED_IN",
  "REFUNDED",
  "TRANSFERRED",
  "GUEST_LIST",
] as const;

export default async function EventAttendeesPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  await auth();
  let event;
  try {
    ({ event } = await requireEventAccess(id));
  } catch {
    notFound();
  }

  const statusFilter = (sp.status ?? "ALL").toUpperCase();

  if (statusFilter === "GUEST_LIST") {
    const guests = await prisma.guestListEntry.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return (
      <AttendeesShell eventId={event.id} active="GUEST_LIST">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-3 py-2">Navn</th>
              <th className="px-3 py-2">E-post</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {guests.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-zinc-500">
                  Ingen på gjesteliste
                </td>
              </tr>
            ) : (
              guests.map((g) => (
                <tr key={g.id} className="border-t border-zinc-100">
                  <td className="px-3 py-2">{g.name}</td>
                  <td className="px-3 py-2">{g.email ?? "—"}</td>
                  <td className="px-3 py-2">
                    {g.checkedInAt ? "CHECKED_IN" : "GUEST_LIST"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </AttendeesShell>
    );
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      eventId: event.id,
      event: { organizationId: event.organizationId },
      ...(statusFilter !== "ALL"
        ? { status: statusFilter as TicketStatus }
        : {}),
    },
    include: {
      ticketType: true,
      order: { select: { orderNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return (
    <AttendeesShell eventId={event.id} active={statusFilter}>
      <div className="mb-3 text-sm">
        <Link
          className="text-amber-700 underline"
          href={`/api/admin/reports?eventId=${event.id}&type=tickets&format=csv`}
        >
          Eksporter CSV
        </Link>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            <th className="px-3 py-2">Navn</th>
            <th className="px-3 py-2">Billettype</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Innsjekk</th>
            <th className="px-3 py-2">Ordre</th>
          </tr>
        </thead>
        <tbody>
          {tickets.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-zinc-500">
                Ingen billetter
              </td>
            </tr>
          ) : (
            tickets.map((t) => (
              <tr key={t.id} className="border-t border-zinc-100">
                <td className="px-3 py-2">{t.holderName ?? "—"}</td>
                <td className="px-3 py-2">{t.ticketType.name}</td>
                <td className="px-3 py-2">{t.status}</td>
                <td className="px-3 py-2">
                  {t.checkedInAt
                    ? t.checkedInAt.toLocaleString("nb-NO")
                    : t.status === "CHECKED_IN"
                      ? "Ja"
                      : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <Link
                    className="text-amber-700 underline"
                    href={`/admin/orders/${t.order.orderNumber}`}
                  >
                    {t.order.orderNumber}
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </AttendeesShell>
  );
}

function AttendeesShell({
  eventId,
  active,
  children,
}: {
  eventId: string;
  active: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/events/${eventId}/attendees${f === "ALL" ? "" : `?status=${f}`}`}
            className={`min-h-11 rounded-md px-3 py-2 ${
              active === f ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-600"
            }`}
          >
            {f === "GUEST_LIST" ? "Gjesteliste" : f}
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">{children}</div>
    </div>
  );
}
