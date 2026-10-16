import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/utils";
import { resolveOrgIdForUser } from "@/lib/admin/org-access";

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

function maskRef(ref: string | null | undefined) {
  if (!ref) return "—";
  if (ref.length <= 12) return ref;
  return `${ref.slice(0, 8)}…${ref.slice(-4)}`;
}

type Props = { params: Promise<{ orderNumber: string }> };

export default async function AdminOrderDetailPage({ params }: Props) {
  const { orderNumber } = await params;
  const session = await auth();
  const orgId = await resolveOrgIdForUser(session!.user.id, session!.user.globalRole);

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
      promoCode: true,
    },
  });
  if (!order) notFound();

  const payment = order.payments[order.payments.length - 1];
  const refundedAmount = order.refunds
    .filter((r) => r.status === "SUCCEEDED")
    .reduce((s, r) => s + r.amount, 0);

  const notifications = await prisma.notificationLog.findMany({
    where: { orderId: order.id },
    orderBy: { sentAt: "desc" },
    take: 20,
  });

  const audit = await prisma.auditLog.findMany({
    where: {
      organizationId: order.organizationId,
      OR: [
        { entityType: "Order", entityId: order.id },
        { entityType: "Ticket", entityId: { in: order.tickets.map((t) => t.id) } },
        { entityType: "Payment", entityId: { in: order.payments.map((p) => p.id) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const transfers =
    order.tickets.length > 0
      ? await prisma.ticketTransfer.findMany({
          where: { ticketId: { in: order.tickets.map((t) => t.id) } },
          orderBy: { transferredAt: "desc" },
        })
      : [];

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/orders" className="text-sm text-[color:var(--muted)] hover:text-foreground">
          ← Ordrer
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Ordre {order.orderNumber}</h1>
        <p className="text-sm text-[color:var(--muted)]">
          {order.customerFirstName} {order.customerLastName} · {order.customerEmail}
          {order.customerPhone ? ` · ${order.customerPhone}` : ""}
        </p>
        <p className="text-sm text-[color:var(--muted)]">{order.event.name}</p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
          <h2 className="text-sm font-medium text-[color:var(--muted)]">Betaling</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Provider</dt>
              <dd>{payment ? providerLabel(payment.provider) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Method</dt>
              <dd>{payment?.paymentMethod ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Provider reference</dt>
              <dd className="font-mono text-xs">{maskRef(payment?.providerPaymentId)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Status</dt>
              <dd>
                {order.paymentStatus}
                {payment?.providerStatus ? (
                  <span className="ml-1 text-xs text-[color:var(--muted)]">
                    ({payment.providerStatus})
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Subtotal</dt>
              <dd>{formatMoney(order.subtotal, order.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Service fee</dt>
              <dd>{formatMoney(order.serviceFee, order.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Discount</dt>
              <dd>
                {formatMoney(order.discount, order.currency)}
                {order.promoCode ? (
                  <span className="ml-1 text-xs text-[color:var(--muted)]">
                    ({order.promoCode.code})
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Amount</dt>
              <dd>{formatMoney(order.total, order.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Refunded</dt>
              <dd>{formatMoney(refundedAmount, order.currency)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
          <h2 className="text-sm font-medium text-[color:var(--muted)]">Timeline</h2>
          <ol className="mt-3 space-y-2 text-sm">
            <li>Opprettet {order.createdAt.toISOString()}</li>
            {order.paidAt ? <li>Betalt {order.paidAt.toISOString()}</li> : null}
            {order.payments.map((p) => (
              <li key={p.id}>
                Payment {p.status} · {providerLabel(p.provider)} · {p.createdAt.toISOString()}
              </li>
            ))}
            {order.refunds.map((r) => (
              <li key={r.id}>
                Refund {r.status} {formatMoney(r.amount, r.currency)} · {r.createdAt.toISOString()}
              </li>
            ))}
            {audit.map((a) => (
              <li key={a.id} className="text-xs text-[color:var(--muted)]">
                {a.action} · {a.createdAt.toISOString()}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
        <h2 className="text-sm font-medium text-[color:var(--muted)]">Billetter</h2>
        <ul className="mt-3 divide-y divide-[color:var(--outline)]/20 text-sm">
          {order.tickets.map((t) => (
            <li key={t.id} className="flex justify-between py-2">
              <span className="font-mono text-xs">{t.publicId}</span>
              <span>
                {t.status}
                {t.checkedInAt ? " · innsjekket" : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {transfers.length > 0 ? (
        <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
          <h2 className="text-sm font-medium text-[color:var(--muted)]">Overføringer</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {transfers.map((t) => (
              <li key={t.id}>
                {t.fromEmail} → {t.toEmail} ({t.toName}) · {t.transferredAt.toISOString()}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5">
        <h2 className="text-sm font-medium text-[color:var(--muted)]">Varsler</h2>
        {notifications.length === 0 ? (
          <p className="mt-2 text-sm text-[color:var(--muted)]">Ingen e-postlogg for denne ordren</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {notifications.map((n) => (
              <li key={n.id} className="flex justify-between gap-4">
                <span>
                  {n.title} · {n.category}
                </span>
                <span className="text-xs text-[color:var(--muted)]">{n.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
