import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOrgIdForUser } from "@/lib/admin/org-access";
import { PromoService } from "@/services/promo-service";
import { PromoManager } from "@/components/admin/promo-manager";

export const dynamic = "force-dynamic";

export default async function AdminPromosPage() {
  const session = await auth();
  const orgId = await resolveOrgIdForUser(session!.user.id, session!.user.globalRole);
  const promos = orgId ? await PromoService.list(orgId) : [];
  const events = orgId
    ? await prisma.event.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
        orderBy: { startsAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Kampanjekoder</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Marketing / promo — rabatt beregnes alltid på server. Historiske ordrer endres ikke ved
          senere endringer.
        </p>
      </div>
      <PromoManager
        initialPromos={promos.map((p) => ({
          id: p.id,
          code: p.code,
          discountType: p.discountType,
          discountValue: p.discountValue,
          usedCount: p.usedCount,
          maxUses: p.maxUses,
          startAt: p.startAt?.toISOString() ?? null,
          expiresAt: p.expiresAt?.toISOString() ?? null,
          isActive: p.isActive,
          event: p.event,
          ticketType: p.ticketType,
        }))}
        events={events}
      />
    </div>
  );
}
