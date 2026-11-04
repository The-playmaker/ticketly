import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { OrderService } from "@/services/order-service";
import { formatMoney } from "@/lib/utils";
import { formatEventDateTime } from "@/lib/time";
import { TicketCarousel } from "@/components/tickets/ticket-carousel";
import { PaymentStatusPoller } from "@/components/orders/payment-status-poller";
import { ResendOrderEmailButton } from "@/components/orders/resend-order-email-button";
import { getOptionalSession } from "@/lib/auth/session";
import { TicketService } from "@/services/ticket-service";
import { safeEqual } from "@/lib/security/safe-equal";

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ paid?: string; checkout?: string; t?: string }>;
};

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

  const viewableTickets = order.tickets.flatMap((ticket) => {
    const raw = TicketService.getDisplayToken(ticket);
    if (!raw) return [];
    return [
      {
        publicId: ticket.publicId,
        secureToken: raw,
        accessToken: order.accessToken,
        holderName: ticket.holderName,
        status: ticket.status,
        ticketTypeName: ticket.ticketType.name,
      },
    ];
  });

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="tl-page max-w-2xl py-10 sm:py-12">
        {isPaid ? (
          <>
            <Badge variant="success">Betalt</Badge>
            <h1 className="mt-3 font-display text-3xl font-semibold text-foreground sm:text-4xl">
              Billettene dine er klare
            </h1>
            <p className="mt-2 text-[color:var(--muted)]">
              Ordrenummer <span className="font-mono text-foreground">{order.orderNumber}</span>
            </p>
            {order.payments[0]?.paymentMethod ? (
              <p className="mt-1 text-sm text-[color:var(--muted)]">
                Betalt med {order.payments[0].paymentMethod}
                {order.payments[0].provider === "NEXI" || order.payments[0].provider === "NETS"
                  ? " via Nexi Checkout"
                  : ""}
              </p>
            ) : null}
          </>
        ) : order.paymentAnomaly || order.paymentStatus === "REVIEW_REQUIRED" ? (
          <>
            <Badge variant="warning">Under gjennomgang</Badge>
            <h1 className="mt-3 font-display text-3xl">Betaling under manuell gjennomgang</h1>
            <p className="mt-2 text-[color:var(--muted)]">
              Ordren er midlertidig sperret. Kontakt support hvis du ble belastet.
            </p>
          </>
        ) : pending ? (
          <>
            <Badge variant="warning">Betalingen behandles</Badge>
            <h1 className="mt-3 font-display text-3xl">Vi bekrefter betalingen</h1>
            <p className="mt-2 text-[color:var(--muted)]">Dette tar vanligvis bare et øyeblikk.</p>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              Vi venter fortsatt på bekreftelse fra betalingsleverandøren.
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
            <Badge variant="danger">Betalingen gikk ikke gjennom</Badge>
            <h1 className="mt-3 font-display text-3xl">Ordre {order.orderNumber}</h1>
          </>
        )}

        <div className="mt-8 tl-panel p-4 sm:p-5">
          <p className="text-sm text-[color:var(--muted)]">Arrangement</p>
          <p className="text-lg font-medium">{order.event.name}</p>
          <p className="text-sm text-[color:var(--muted)]">
            {formatEventDateTime(order.event.startsAt, order.event.timezone)} ·{" "}
            {order.event.venue?.name ?? order.event.city}
          </p>
          {order.event.ageLimit != null ? (
            <p className="mt-2 text-sm text-[color:var(--accent-soft)]">
              {order.event.ageLimit}+ · Gyldig legitimasjon kreves
            </p>
          ) : null}
          <p className="mt-4 text-sm text-[color:var(--muted)]">Totalt</p>
          <p className="text-xl font-semibold text-[color:var(--accent-soft)]">
            {formatMoney(order.total, order.currency)}
          </p>
          {isPaid ? (
            <p className="mt-4 text-sm text-[color:var(--muted)]">
              Billetter og kvittering er sendt til:{" "}
              <span className="text-foreground">{order.customerEmail}</span>
            </p>
          ) : null}
        </div>

        {isPaid && viewableTickets.length > 0 && canViewTickets ? (
          <div className="mt-10 space-y-6">
            <TicketCarousel
              tickets={viewableTickets}
              event={{
                name: order.event.name,
                startsAt: order.event.startsAt.toISOString(),
                timezone: order.event.timezone,
                venue: order.event.venue?.name ?? order.event.city ?? "",
                ageLimit: order.event.ageLimit,
              }}
              orderNumber={order.orderNumber}
            />
            {hasAccessToken ? (
              <ResendOrderEmailButton
                orderNumber={order.orderNumber}
                accessToken={order.accessToken}
              />
            ) : null}
          </div>
        ) : isPaid && order.tickets.length > 0 ? (
          <div className="mt-10 rounded-xl border border-[color:var(--warning)]/35 bg-[color:var(--warning)]/10 p-5 text-sm text-[color:var(--warning)]">
            Billetter er utstedt. Bruk lenken fra e-posten (eller logg inn som kjøper) for å vise
            QR-koder.
          </div>
        ) : null}

        <div className="mt-10 border-t border-[color:var(--outline)]/25 pt-6 text-sm text-[color:var(--muted)]">
          <p className="font-medium text-[color:var(--muted)]">Support</p>
          <p className="mt-1">
            {(order.event.organization.customerServiceEmail ??
              order.event.organization.contactEmail) && (
              <>
                E-post:{" "}
                <a
                  className="text-[color:var(--accent-soft)] hover:underline"
                  href={`mailto:${order.event.organization.customerServiceEmail ?? order.event.organization.contactEmail}`}
                >
                  {order.event.organization.customerServiceEmail ??
                    order.event.organization.contactEmail}
                </a>
              </>
            )}
          </p>
          {order.event.organization.customerServicePhone ? (
            <p>Telefon: {order.event.organization.customerServicePhone}</p>
          ) : null}
          <p className="mt-3 flex flex-wrap gap-3">
            <Link href="/terms" className="hover:text-foreground">
              Kjøpsvilkår
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Personvern
            </Link>
            <Link href="/refund-policy" className="hover:text-foreground">
              Refusjon
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
