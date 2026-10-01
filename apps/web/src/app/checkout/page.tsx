import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { prisma } from "@/lib/db";
import { calculatePricing } from "@/services/order-service";

type Props = {
  searchParams: Promise<{ event?: string; session?: string; items?: string; cancelled?: string }>;
};

export default async function CheckoutPage({ searchParams }: Props) {
  const params = await searchParams;
  if (!params.event || !params.session || !params.items) {
    return (
      <div>
        <SiteHeader />
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="font-display text-2xl">Ingen billetter valgt</h1>
          <p className="mt-2 text-zinc-400">Gå tilbake til et arrangement og velg billetter.</p>
        </main>
      </div>
    );
  }

  let items: { ticketTypeId: string; quantity: number }[] = [];
  try {
    items = JSON.parse(params.items);
  } catch {
    notFound();
  }

  const event = await prisma.event.findFirst({
    where: { slug: params.event },
    include: {
      organization: true,
      ticketTypes: { include: { priceTiers: true } },
    },
  });
  if (!event) notFound();

  const pricing = calculatePricing({
    organization: event.organization,
    event,
    ticketTypes: event.ticketTypes,
    items,
  });

  return (
    <div>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="font-display text-3xl">Checkout</h1>
        {params.cancelled ? (
          <p className="mt-2 text-sm text-amber-400">Betaling avbrutt — billetter er fortsatt reservert en kort stund.</p>
        ) : null}
        <div className="mt-8">
          <CheckoutForm
            eventId={event.id}
            eventName={event.name}
            sessionId={params.session}
            items={items}
            estimatedTotal={pricing.total}
          />
        </div>
      </main>
    </div>
  );
}
