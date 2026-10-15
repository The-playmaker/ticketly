import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireEventAccess } from "@/lib/admin/org-access";
import { eventInventorySnapshot, inventorySnapshot } from "@/services/inventory-service";

type Props = { params: Promise<{ id: string }> };

export default async function EventSettingsPage({ params }: Props) {
  const { id } = await params;
  await auth();
  let event;
  try {
    ({ event } = await requireEventAccess(id));
  } catch {
    notFound();
  }

  const full = await prisma.event.findUniqueOrThrow({
    where: { id: event.id },
    include: {
      organization: true,
      sellerOrganization: true,
      ticketTypes: { orderBy: { sortOrder: "asc" } },
    },
  });

  const inv = eventInventorySnapshot(
    full.capacity,
    full.ticketTypes.map((t) => ({
      quantityTotal: t.quantityTotal,
      quantityReleased: t.quantityReleased,
      quantitySold: t.quantitySold,
      quantityReserved: t.quantityReserved,
    }))
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm">
        <h2 className="font-medium">Arrangement</h2>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Status</dt>
            <dd>{full.status}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Synlighet</dt>
            <dd>{full.visibility}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Kapasitet (event)</dt>
            <dd>{inv.capacity}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Salg pauset</dt>
            <dd>{full.salesPausedAt ? full.salesPausedAt.toISOString() : "Nei"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm">
        <h2 className="font-medium">Selger (seller of record)</h2>
        <p className="mt-2 text-zinc-700">
          {(full.sellerOrganization ?? full.organization).legalName ??
            (full.sellerOrganization ?? full.organization).name}
        </p>
        <p className="text-zinc-500">
          Org.nr {(full.sellerOrganization ?? full.organization).organizationNumber ?? "—"}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Betalingsintegrasjon overskriver ikke juridisk selgerdata.
        </p>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm">
        <h2 className="font-medium">Inventory (sentral formel)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          available = released − sold − reserved · unreleased = allocation − released
        </p>
        <ul className="mt-3 space-y-3">
          {full.ticketTypes.map((t) => {
            const s = inventorySnapshot(t);
            return (
              <li key={t.id} className="rounded-lg border border-zinc-100 p-3">
                <p className="font-medium">{t.name}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  allocation {s.allocation} · released {s.released} · sold {s.sold} · reserved{" "}
                  {s.reserved} · available {s.available} · unreleased {s.unreleased}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
