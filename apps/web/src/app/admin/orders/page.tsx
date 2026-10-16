import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/utils";

async function orgIdFor(userId: string, globalRole: string) {
  if (globalRole === "SUPER_ADMIN") {
    return (await prisma.organization.findFirst({ where: { slug: "titan-events" } }))?.id;
  }
  return (await prisma.organizationMember.findFirst({ where: { userId, isActive: true } }))
    ?.organizationId;
}

export default async function AdminOrdersPage() {
  const session = await auth();
  const orgId = await orgIdFor(session!.user.id, session!.user.globalRole);
  const orders = orgId
    ? await prisma.order.findMany({
        where: { organizationId: orgId },
        include: { event: true, tickets: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Ordrer</h1>
      <div className="overflow-hidden rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--surface-high)] text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">Ordrenr</th>
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Totalt</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-[color:var(--outline)]/20">
                <td className="px-4 py-3 font-mono text-xs">
                  <a className="text-[color:var(--accent)] underline" href={`/admin/orders/${o.orderNumber}`}>
                    {o.orderNumber}
                  </a>
                </td>
                <td className="px-4 py-3">
                  {o.customerFirstName} {o.customerLastName}
                  <div className="text-xs text-[color:var(--muted)]">{o.customerEmail}</div>
                </td>
                <td className="px-4 py-3">{o.event.name}</td>
                <td className="px-4 py-3">
                  {o.paymentStatus} / {o.orderStatus}
                </td>
                <td className="px-4 py-3">{formatMoney(o.total, o.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
