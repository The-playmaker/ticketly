import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PromoService } from "@/services/promo-service";
import { PromoterManager } from "@/components/admin/promoter-manager";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function EventPromotersPage({ params }: Props) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, organizationId: true },
  });
  if (!event) notFound();

  const promoters = await PromoService.salesReport({
    organizationId: event.organizationId,
    eventId: event.id,
    kind: "TRACKING",
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Promotører</h2>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Sporingslenker for dette arrangementet. Format:{" "}
          <code className="rounded bg-[color:var(--surface-high)] px-1.5 py-0.5 text-xs">
            /events/{event.slug}?ref=KODE
          </code>
        </p>
      </div>
      <PromoterManager
        initialPromoters={promoters}
        events={[{ id: event.id, name: event.name, slug: event.slug }]}
        defaultEventId={event.id}
      />
    </div>
  );
}
