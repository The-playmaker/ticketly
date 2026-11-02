import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/api-error";
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

  let promoters;
  try {
    promoters = await PromoService.salesReport({
      organizationId: event.organizationId,
      eventId: event.id,
      kind: "TRACKING",
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "DB_MIGRATION_REQUIRED") {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Promotører</h2>
          <div
            role="alert"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
          >
            <p className="font-medium">Database-migrasjon mangler</p>
            <p className="mt-1 text-[color:var(--muted)]">
              Kjør <code className="text-xs">npm run db:migrate</code> (
              <code className="text-xs">prisma migrate deploy</code>) for å legge til
              promotørfeltene før denne siden kan brukes.
            </p>
          </div>
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Promotører</h2>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Kun sporing (ingen rabatt) for dette arrangementet. Format:{" "}
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
