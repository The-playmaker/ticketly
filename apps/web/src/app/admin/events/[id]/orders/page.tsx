import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/utils";
import { requireEventAccess } from "@/lib/admin/org-access";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
};

export default async function EventOrdersPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  await auth();
  let event;
  try {
    ({ event } = await requireEventAccess(id));
  } catch {
    notFound();
  }

  const q = sp.q?.trim();
  const orders = await prisma.order.findMany({
    where: {
      eventId: event.id,
      organizationId: event.organizationId,
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: "insensitive" } },
              { customerEmail: { contains: q, mode: "insensitive" } },
              { customerPhone: { contains: q, mode: "insensitive" } },
              { tickets: { some: { publicId: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-4">
      <form className="flex gap-2">
        <label className="sr-only" htmlFor="q">
          Søk
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Ordrenr, e-post, telefon, billett-ID"
          className="min-h-11 flex-1 rounded-md border border-zinc-300 px-3 text-sm"
        />
        <button type="submit" className="min-h-11 rounded-md bg-zinc-900 px-4 text-sm text-white">
          Søk
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-3 py-2">Ordrenr</th>
              <th className="px-3 py-2">Kunde</th>
              <th className="px-3 py-2">Beløp</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Metode</th>
              <th className="px-3 py-2">Opprettet</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">
                  Ingen ordrer{q ? " matchet søket" : " ennå"}
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-t border-zinc-100">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      className="text-amber-700 underline"
                      href={`/admin/orders/${o.orderNumber}`}
                    >
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {o.customerFirstName} {o.customerLastName}
                    <div className="text-xs text-zinc-500">{o.customerEmail}</div>
                  </td>
                  <td className="px-3 py-2">{formatMoney(o.total, o.currency)}</td>
                  <td className="px-3 py-2">{o.paymentStatus}</td>
                  <td className="px-3 py-2">{o.payments[0]?.paymentMethod ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {o.createdAt.toLocaleString("nb-NO")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
