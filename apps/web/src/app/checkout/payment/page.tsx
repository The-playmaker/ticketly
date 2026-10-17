import { notFound } from "next/navigation";
import { PaymentProviderType } from "@prisma/client";
import { SiteHeader } from "@/components/layout/site-header";
import { NexiCheckoutContainer } from "@/components/checkout/nexi-checkout-container";
import { StripeCheckoutContainer } from "@/components/checkout/stripe-checkout-container";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/utils";
import { getNexiCheckoutKey, getNexiCheckoutScriptUrl } from "@/lib/payments/nexi-config";
import {
  getStripePublishableKey,
  retrieveStripeCheckoutClientSecret,
  STRIPE_CHECKOUT_SCRIPT_URL,
} from "@/lib/payments/stripe-provider";
import { timingSafeEqual } from "crypto";
import { ReservationCountdown } from "@/components/checkout/reservation-countdown";

type Props = {
  searchParams: Promise<{
    paymentId?: string;
    orderNumber?: string;
    t?: string;
  }>;
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

export default async function CheckoutPaymentPage({ searchParams }: Props) {
  const sp = await searchParams;
  if (!sp.paymentId) {
    return (
      <div>
        <SiteHeader />
        <main className="mx-auto max-w-5xl px-4 py-16 text-center">
          <h1 className="font-display text-2xl">Mangler betalingsøkt</h1>
          <p className="mt-2 text-zinc-400">Start checkout på nytt fra arrangementet.</p>
        </main>
      </div>
    );
  }

  const payment = await prisma.payment.findFirst({
    where: {
      OR: [{ providerPaymentId: sp.paymentId }, { providerSessionId: sp.paymentId }],
    },
    include: {
      order: {
        include: {
          event: { include: { organization: true } },
          items: true,
          reservations: {
            where: { status: { in: ["ACTIVE", "EXPIRED", "CONVERTED"] } },
            orderBy: { expiresAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!payment?.order) notFound();
  const order = payment.order;

  if (sp.t && !safeEqual(sp.t, order.accessToken)) {
    notFound();
  }
  if (sp.orderNumber && sp.orderNumber !== order.orderNumber) {
    notFound();
  }

  const isStripe = payment.provider === PaymentProviderType.STRIPE;

  let nexiCheckoutKey: string | undefined;
  let nexiCheckoutScriptUrl: string | undefined;
  let stripeClientSecret: string | undefined;
  let stripePublishableKey: string | undefined;

  if (isStripe) {
    try {
      stripePublishableKey = getStripePublishableKey();
      stripeClientSecret = await retrieveStripeCheckoutClientSecret(
        payment.providerSessionId ?? sp.paymentId
      );
    } catch {
      return (
        <div>
          <SiteHeader />
          <main className="mx-auto max-w-lg px-4 py-16 text-center">
            <h1 className="font-display text-2xl text-[color:var(--accent-soft)]">
              Betaling utilgjengelig
            </h1>
            <p className="mt-2 text-zinc-400">
              Stripe Checkout er ikke konfigurert eller økten er utløpt. Start checkout på nytt.
            </p>
          </main>
        </div>
      );
    }
  } else {
    try {
      nexiCheckoutKey = getNexiCheckoutKey();
      nexiCheckoutScriptUrl = getNexiCheckoutScriptUrl();
    } catch {
      return (
        <div>
          <SiteHeader />
          <main className="mx-auto max-w-lg px-4 py-16 text-center">
            <h1 className="font-display text-2xl text-[color:var(--accent-soft)]">
              Betaling utilgjengelig
            </h1>
            <p className="mt-2 text-zinc-400">
              Nexi Checkout er ikke konfigurert. Kontakt support eller prøv senere.
            </p>
          </main>
        </div>
      );
    }
  }

  const seller = order.event.organization;
  const reservation = order.reservations[0];

  return (
    <div>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-display text-3xl text-white">Betaling</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ordre <span className="font-mono text-zinc-200">{order.orderNumber}</span>
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
          <section className="space-y-4">
            <div className="rounded-xl border border-[color:var(--outline)]/30 bg-zinc-900/40 p-4">
              <h2 className="text-sm font-medium text-zinc-300">Kontakt</h2>
              <p className="mt-2 text-white">
                {order.customerFirstName} {order.customerLastName}
              </p>
              <p className="text-sm text-zinc-400">{order.customerEmail}</p>
              {order.customerPhone ? (
                <p className="text-sm text-zinc-400">{order.customerPhone}</p>
              ) : null}
            </div>

            <div className="rounded-xl border border-[color:var(--outline)]/30 bg-zinc-900/40 p-4">
              {isStripe && stripeClientSecret && stripePublishableKey ? (
                <StripeCheckoutContainer
                  clientSecret={stripeClientSecret}
                  publishableKey={stripePublishableKey}
                  checkoutScriptUrl={STRIPE_CHECKOUT_SCRIPT_URL}
                  orderNumber={order.orderNumber}
                  accessToken={order.accessToken}
                  paymentStatus={order.paymentStatus}
                  paymentAnomaly={order.paymentAnomaly}
                  reservationExpiresAt={reservation?.expiresAt?.toISOString() ?? null}
                  reservationStatus={reservation?.status ?? null}
                />
              ) : nexiCheckoutKey && nexiCheckoutScriptUrl ? (
                <NexiCheckoutContainer
                  paymentId={sp.paymentId}
                  checkoutKey={nexiCheckoutKey}
                  checkoutScriptUrl={nexiCheckoutScriptUrl}
                  orderNumber={order.orderNumber}
                  accessToken={order.accessToken}
                  paymentStatus={order.paymentStatus}
                  paymentAnomaly={order.paymentAnomaly}
                  reservationExpiresAt={reservation?.expiresAt?.toISOString() ?? null}
                  reservationStatus={reservation?.status ?? null}
                />
              ) : null}
            </div>
          </section>

          <aside className="h-fit space-y-4 lg:sticky lg:top-6">
            <div className="rounded-xl border border-[color:var(--outline)]/30 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-[color:var(--muted)]">Oppsummering</p>
              <p className="mt-2 font-medium text-white">{order.event.name}</p>
              <ul className="mt-4 space-y-2 text-sm text-zinc-300">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span>
                      {item.quantity}× {item.name}
                    </span>
                    <span>{formatMoney(item.total, order.currency)}</span>
                  </li>
                ))}
              </ul>
              {order.serviceFee > 0 ? (
                <div className="mt-2 flex justify-between text-sm text-zinc-400">
                  <span>Serviceavgift</span>
                  <span>{formatMoney(order.serviceFee, order.currency)}</span>
                </div>
              ) : null}
              <div className="mt-4 flex justify-between border-t border-[color:var(--outline)]/30 pt-3 text-lg font-semibold text-[color:var(--accent-soft)]">
                <span>Totalt</span>
                <span>{formatMoney(order.total, order.currency)}</span>
              </div>
              {reservation?.expiresAt ? (
                <ReservationCountdown expiresAt={reservation.expiresAt.toISOString()} />
              ) : null}
            </div>

            <div className="rounded-xl border border-[color:var(--outline)]/30 bg-[color:var(--background)]/50 p-4 text-xs text-[color:var(--muted)]">
              <p className="font-medium text-zinc-400">Selger</p>
              <p className="mt-1 text-zinc-300">
                {seller.legalName ?? seller.name}
                {seller.organizationNumber ? ` · Org.nr ${seller.organizationNumber}` : null}
              </p>
              <p className="mt-2">
                Ved å betale godtar du{" "}
                <a className="text-[color:var(--accent)] underline" href="/terms">
                  Kjøpsvilkår
                </a>
                ,{" "}
                <a className="text-[color:var(--accent)] underline" href="/refund-policy">
                  Refusjonspolicy
                </a>{" "}
                og bekrefter at du har lest{" "}
                <a className="text-[color:var(--accent)] underline" href="/privacy">
                  Personvernerklæringen
                </a>
                .
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
