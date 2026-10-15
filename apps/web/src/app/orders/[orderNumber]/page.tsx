import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrderService } from "@/services/order-service";
import { formatMoney } from "@/lib/utils";
import { formatEventDateTime } from "@/lib/time";
import { TicketQrCard } from "@/components/tickets/ticket-qr-card";
import { PaymentStatusPoller } from "@/components/orders/payment-status-poller";
import { getOptionalSession } from "@/lib/auth/session";
import { TicketService } from "@/services/ticket-service";
import { timingSafeEqual } from "crypto";

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ paid?: string; checkout?: string; t?: string }>;
};

function safeEqual(a: string, b: string) {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export default async function OrderConfirmationPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const order = await OrderService.getByOrderNumber(orderNumber);
  if (!order) notFound();

  const session = await getOptionalSession();
  const isOwner = Boolean(session && order.customerId && session.id === order.customerId);
  const hasAccessToken = Boolean(sp.t && safeEqual(sp.t, order.accessToken));
  const canViewTickets = isOwner || hasAccessToken;

  const isPaid = order.paymentStatus === "PAID";
  const pending = order.paymentStatus === "PENDING";

  return (
    <div>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-12">
        {isPaid ? (
          <>
            <Badge variant="success">Betalt</Badge>
            <h1 className="mt-3 font-display text-4xl text-white">Billettene dine er klare</h1>
            <p className="mt-2 text-zinc-400">
              Ordrenummer <span className="font-mono text-zinc-200">{order.orderNumber}</span>
            </p>
          </>
        ) : pending ? (
          <>
            <Badge variant="warning">Venter på bekreftelse</Badge>
            <h1 className="mt-3 font-display text-3xl">Vi bekrefter betalingen…</h1>
            <p className="mt-2 text-zinc-400">
              Success-siden er ikke betalingsbevis. Vi venter på bekreftet status fra
              betalingsleverandør via webhook.
            </p>
            {hasAccessToken ? (
              <PaymentStatusPoller
                orderNumber={order.orderNumber}
                accessToken={order.accessToken}
                initialStatus={order.paymentStatus}
              />
            ) : null}
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

        {isPaid && order.tickets.length > 0 && canViewTickets ? (
          <div className="mt-10 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Dine billetter</h2>
              <Button asChild variant="secondary" size="sm">
                <Link
                  href={`/api/tickets/${order.tickets[0]!.publicId}/pdf?t=${order.accessToken}`}
                >
                  Last ned PDF
                </Link>
              </Button>
            </div>
            {order.tickets.map((ticket) => {
              const raw = TicketService.getDisplayToken(ticket);
              if (!raw) return null;
              return (
                <TicketQrCard
                  key={ticket.id}
                  ticket={{
                    publicId: ticket.publicId,
                    secureToken: raw,
                    accessToken: order.accessToken,
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
              );
            })}
          </div>
        ) : isPaid && order.tickets.length > 0 ? (
          <div className="mt-10 rounded-2xl border border-amber-900/50 bg-amber-950/30 p-5 text-sm text-amber-100">
            Billetter er utstedt. Bruk lenken fra e-posten (eller logg inn som kjøper) for å vise QR-koder.
          </div>
        ) : null}
      </main>
    </div>
  );
}
