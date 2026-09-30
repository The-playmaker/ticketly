import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrderService } from "@/services/order-service";
import { formatMoney } from "@/lib/utils";
import { formatEventDateTime } from "@/lib/time";
import { TicketQrCard } from "@/components/tickets/ticket-qr-card";

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ paid?: string; checkout?: string }>;
};

export default async function OrderConfirmationPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const order = await OrderService.getByOrderNumber(orderNumber);
  if (!order) notFound();

  const isPaid = order.paymentStatus === "PAID";
  const pending = order.paymentStatus === "PENDING";

  return (
    <div>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-12">
        {isPaid ? (
          <>
            <Badge variant="success">Betalt</Badge>
            <h1 className="mt-3 font-display text-4xl text-white">Takk for kjøpet</h1>
            <p className="mt-2 text-zinc-400">
              Ordrenummer <span className="font-mono text-zinc-200">{order.orderNumber}</span>
            </p>
          </>
        ) : pending ? (
          <>
            <Badge variant="warning">Venter på betaling</Badge>
            <h1 className="mt-3 font-display text-3xl">Behandler betaling…</h1>
            <p className="mt-2 text-zinc-400">
              Vi venter på bekreftelse fra betalingsleverandør. Oppdater siden om noen sekunder.
              {sp.checkout === "success" ? " (redirect er ikke nok — webhook bekrefter)" : null}
            </p>
          </>
        ) : (
          <>
            <Badge variant="danger">{order.paymentStatus}</Badge>
            <h1 className="mt-3 font-display text-3xl">Ordre {order.orderNumber}</h1>
          </>
        )}

        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-sm text-zinc-500">Arrangement</p>
          <p className="text-lg font-medium">{order.event.name}</p>
          <p className="text-sm text-zinc-400">
            {formatEventDateTime(order.event.startsAt, order.event.timezone)} ·{" "}
            {order.event.venue?.name ?? order.event.city}
          </p>
          <p className="mt-4 text-sm text-zinc-500">Totalt</p>
          <p className="text-xl font-semibold text-amber-300">
            {formatMoney(order.total, order.currency)}
          </p>
        </div>

        {isPaid && order.tickets.length > 0 ? (
          <div className="mt-10 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Dine billetter</h2>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/orders/${order.orderNumber}/pdf`}>Last ned PDF</Link>
              </Button>
            </div>
            {order.tickets.map((ticket) => (
              <TicketQrCard
                key={ticket.id}
                ticket={{
                  publicId: ticket.publicId,
                  secureToken: ticket.secureToken,
                  holderName: ticket.holderName,
                  status: ticket.status,
                  ticketTypeName: ticket.ticketType.name,
                }}
                event={{
                  name: order.event.name,
                  startsAt: order.event.startsAt.toISOString(),
                  timezone: order.event.timezone,
                  venue: order.event.venue?.name ?? order.event.city ?? "",
                }}
                orderNumber={order.orderNumber}
              />
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
