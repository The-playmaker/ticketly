import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireEventAccess } from "@/lib/admin/org-access";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { eventInventorySnapshot, inventorySnapshot } from "@/services/inventory-service";
import { DuplicateEventButton } from "@/components/admin/duplicate-event-button";
import { EventParitySettingsForm } from "@/components/admin/event-parity-settings-form";
import { EventOwnershipForm } from "@/components/admin/event-ownership-form";
import { EventTestResetForm } from "@/components/admin/event-test-reset-form";
import { EditEventLink } from "@/components/admin/edit-event-link";

type Props = { params: Promise<{ id: string }> };

export default async function EventSettingsPage({ params }: Props) {
  const { id } = await params;
  await auth();
  let event;
  let user;
  try {
    ({ event, user } = await requireEventAccess(id));
  } catch {
    notFound();
  }

  const full = await prisma.event.findUniqueOrThrow({
    where: { id: event.id },
    include: {
      organization: true,
      sellerOrganization: true,
      ticketTypes: { orderBy: { sortOrder: "asc" } },
      series: true,
    },
  });

  const platformAdmin = isSuperAdmin(user);
  const activeOrganizations = platformAdmin
    ? await prisma.organization.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, legalName: true, isActive: true },
      })
    : [];

  const inv = eventInventorySnapshot(
    full.capacity,
    full.ticketTypes.map((t) => ({
      quantityTotal: t.quantityTotal,
      quantityReleased: t.quantityReleased,
      quantitySold: t.quantitySold,
      quantityReserved: t.quantityReserved,
    }))
  );

  const seller = full.sellerOrganization ?? full.organization;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[color:var(--muted)]">
          Full redigering av tittel, billetter, cover og mer.
        </p>
        <EditEventLink eventId={full.id} />
      </div>

      <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm">
        <h2 className="font-medium">Arrangement</h2>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-[color:var(--muted)]">Status</dt>
            <dd>{full.status}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--muted)]">Synlighet</dt>
            <dd>{full.visibility}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--muted)]">Kapasitet (event)</dt>
            <dd>{inv.capacity}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--muted)]">Salg pauset</dt>
            <dd>{full.salesPausedAt ? full.salesPausedAt.toISOString() : "Nei"}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--muted)]">Serie</dt>
            <dd>{full.series?.name ?? "—"}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <DuplicateEventButton eventId={full.id} />
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            Kopierer metadata, venue, billettyper og policy — ikke ordrer, billetter eller betalinger.
          </p>
        </div>
      </section>

      <EventParitySettingsForm
        eventId={full.id}
        waitlistEnabled={full.waitlistEnabled}
        waitlistOnReleaseSoldOut={full.waitlistOnReleaseSoldOut}
        reminder24hEnabled={full.reminder24hEnabled}
        reminder3hEnabled={full.reminder3hEnabled}
      />

      {platformAdmin ? (
        <>
          <EventOwnershipForm
            eventId={full.id}
            organizationId={full.organizationId}
            sellerOrganizationId={full.sellerOrganizationId}
            organizations={activeOrganizations}
          />
          <EventTestResetForm eventId={full.id} />
        </>
      ) : (
        <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm">
          <h2 className="font-medium">Selger (seller of record)</h2>
          <p className="mt-2">{seller.legalName ?? seller.name}</p>
          <p className="text-[color:var(--muted)]">Org.nr {seller.organizationNumber ?? "—"}</p>
          <p className="mt-2 text-xs text-[color:var(--muted)]">
            Organisator: {full.organization.name}
          </p>
        </section>
      )}

      <section className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm">
        <h2 className="font-medium">Inventory</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          available = released − sold − reserved · Bundles: admissionCount QR per unit
        </p>
        <ul className="mt-3 space-y-3">
          {full.ticketTypes.map((t) => {
            const s = inventorySnapshot(t);
            return (
              <li key={t.id} className="rounded-lg border border-[color:var(--outline)]/20 p-3">
                <p className="font-medium">
                  {t.name}
                  {t.isBundle ? (
                    <span className="ml-2 text-xs text-[color:var(--muted)]">
                      Bundle ×{t.admissionCount}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  allocation {s.allocation} · released {s.released} · sold {s.sold} · reserved{" "}
                  {s.reserved} · available {s.available} · min {t.minPerOrder} / max {t.maxPerOrder}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
