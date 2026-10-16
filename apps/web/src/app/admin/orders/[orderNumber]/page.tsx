import { notFound } from "next/navigation";
import Link from "next/link";
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

function providerLabel(provider: string) {
  switch (provider) {
    case "NEXI":
    case "NETS":
      return "Nexi Checkout";
    case "STRIPE":
      return "Stripe";
    case "MOCK":
      return "Mock (dev)";
    default:
      return provider;
  }
}

type Props = { params: Promise<{ orderNumber: string }> };

export default async function AdminOrderDetailPage({ params }: Props) {
  const { orderNumber } = await params;
  const session = await auth();
  const orgId = await orgIdFor(session!.user.id, session!.user.globalRole);

  const order = await prisma.order.findFirst({
    where: {
      orderNumber,
      ...(orgId ? { organizationId: orgId } : { id: "impossible" }),
    },
    include: {
      event: true,
      items: true,
      tickets: true,
      payments: { orderBy: { createdAt: "asc" } },
      refunds: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  const payment = order.payments[order.payments.length - 1];
  const refundedAmount = order.refunds
    .filter((r) => r.status === "SUCCEEDED")
    .reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/orders" className="text-sm text-[color:var(--muted)] hover:text-zinc-800">
          ← Ordrer
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Ordre {order.orderNumber}</h1>
        <p className="text-sm text-[color:var(--muted)]">
          {order.customerFirstName} {order.customerLastName} · {order.customerEmail}
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
          <h2 className="text-sm font-medium text-[color:var(--muted)]">Betaling</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Payment provider</dt>
              <dd>{payment ? providerLabel(payment.provider) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Payment method</dt>
              <dd>{payment?.paymentMethod ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Provider payment ID</dt>
              <dd className="font-mono text-xs">{payment?.providerPaymentId ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Status</dt>
              <dd>
                {order.paymentStatus}
                {payment?.providerStatus ? (
                  <span className="ml-1 text-xs text-zinc-400">({payment.providerStatus})</span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Paid amount</dt>
              <dd>{formatMoney(order.total, order.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Refunded amount</dt>
              <dd>{formatMoney(refundedAmount, order.currency)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
          <h2 className="text-sm font-medium text-[color:var(--muted)]">Timeline</h2>
          <ol className="mt-3 space-y-2 text-sm text-zinc-700">
            <li>Opprettet {order.createdAt.toISOString()}</li>
            {order.paidAt ? <li>Betalt {order.paidAt.toISOString()}</li> : null}
            {order.payments.map((p) => (
              <li key={p.id}>
                Payment {p.status} · {p.createdAt.toISOString()}
              </li>
            ))}
            {order.refunds.map((r) => (
              <li key={r.id}>
                Refund {r.status} {formatMoney(r.amount, r.currency)} · {r.createdAt.toISOString()}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
        <h2 className="text-sm font-medium text-[color:var(--muted)]">Billetter</h2>
        <ul className="mt-3 divide-y divide-zinc-100 text-sm">
          {order.tickets.map((t) => (
            <li key={t.id} className="flex justify-between py-2">
              <span className="font-mono text-xs">{t.publicId}</span>
              <span>{t.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
