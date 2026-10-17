import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireEventManageAccess } from "@/lib/admin/org-access";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { EditEventForm } from "@/components/admin/edit-event-form";
import { Button } from "@/components/ui/button";

type Props = { params: Promise<{ id: string }> };

export default async function EditEventPage({ params }: Props) {
  const { id } = await params;
  await auth();

  let event;
  let user;
  try {
    ({ event, user } = await requireEventManageAccess(id));
  } catch {
    notFound();
  }

  const full = await prisma.event.findUniqueOrThrow({
    where: { id: event.id },
    include: {
      venue: true,
      ticketTypes: { orderBy: { sortOrder: "asc" } },
    },
  });

  const platformAdmin = isSuperAdmin(user);
  const organizations = platformAdmin
    ? await prisma.organization.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, legalName: true, isActive: true },
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Rediger arrangement</h2>
          <p className="text-sm text-[color:var(--muted)]">
            Endringer bevarer ordrer, betalinger, billetter og innsjekk.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href={`/admin/events/${full.id}/settings`}>Til innstillinger</Link>
        </Button>
      </div>

      <EditEventForm
        isPlatformAdmin={platformAdmin}
        organizations={organizations}
        initial={{
          id: full.id,
          name: full.name,
          description: full.description ?? "",
          shortDescription: full.shortDescription ?? "",
          category: full.category ?? "",
          address: full.address ?? "",
          postalCode: full.postalCode ?? "",
          city: full.city ?? "",
          country: full.country,
          timezone: full.timezone,
          startsAt: full.startsAt.toISOString(),
          endsAt: full.endsAt.toISOString(),
          doorsOpenAt: full.doorsOpenAt?.toISOString() ?? "",
          ageLimit: full.ageLimit ?? "",
          capacity: full.capacity,
          status: full.status,
          visibility: full.visibility,
          salesStartAt: full.salesStartAt?.toISOString() ?? "",
          salesEndAt: full.salesEndAt?.toISOString() ?? "",
          coverImageUrl: full.coverImageUrl,
          updatedAt: full.updatedAt.toISOString(),
          venueName: full.venue?.name ?? "",
          organizationId: full.organizationId,
          sellerOrganizationId: full.sellerOrganizationId,
          ticketTypes: full.ticketTypes.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description ?? "",
            priceKr: t.price / 100,
            quantityTotal: t.quantityTotal,
            quantityReleased: t.quantityReleased,
            quantitySold: t.quantitySold,
            quantityReserved: t.quantityReserved,
            maxPerOrder: t.maxPerOrder,
            minPerOrder: t.minPerOrder,
            salesStartAt: t.salesStartAt?.toISOString() ?? "",
            salesEndAt: t.salesEndAt?.toISOString() ?? "",
            isVisible: t.isVisible,
            sortOrder: t.sortOrder,
          })),
        }}
      />
    </div>
  );
}
