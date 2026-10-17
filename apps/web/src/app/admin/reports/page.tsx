import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { organizationIdWhere } from "@/lib/admin/org-context";
import { isDoorStaffOnly } from "@/lib/auth/event-access";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";

export const dynamic = "force-dynamic";

const TYPES = [
  { type: "orders", label: "Ordrer" },
  { type: "tickets", label: "Billetter" },
  { type: "attendees", label: "Deltakere" },
  { type: "guestlist", label: "Gjesteliste" },
  { type: "checkins", label: "Check-ins" },
  { type: "refunds", label: "Refusjoner" },
  { type: "promos", label: "Promo-bruk" },
] as const;

export default async function AdminReportsPage() {
  const session = await auth();
  const user = {
    id: session!.user.id,
    email: session!.user.email!,
    globalRole: session!.user.globalRole,
    isActive: session!.user.isActive !== false,
    memberships: session!.user.memberships,
  };
  if (isDoorStaffOnly(user)) redirect("/scan");

  const scope = await resolveOrgScopeForUser(session!.user.id, session!.user.globalRole);

  if (scope.mode === "none" && scope.isPlatformAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Rapporter / eksport</h1>
        <NoOrganizationPanel showCreateCta />
      </div>
    );
  }

  const events = await prisma.event.findMany({
    where: organizationIdWhere(scope.organizationId),
    include: { organization: { select: { name: true } } },
    orderBy: { startsAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rapporter / eksport</h1>
        <p className="text-sm text-[color:var(--muted)]">
          CSV og Excel. Inneholder ikke QR-token, betalingshemmeligheter eller audit-metadata.
          {scope.mode === "global" ? " · Alle organisasjoner" : ""}
        </p>
      </div>
      <div className="space-y-3">
        {events.map((e) => (
          <div
            key={e.id}
            className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-4"
          >
            <div className="mb-3">
              <p className="font-medium">{e.name}</p>
              <p className="text-xs text-[color:var(--muted)]">
                {e.status}
                {scope.mode === "global" ? ` · ${e.organization.name}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {TYPES.map((t) => (
                <span key={t.type} className="inline-flex gap-1">
                  <Link
                    className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-[color:var(--accent-foreground)]"
                    href={`/api/admin/reports?eventId=${e.id}&type=${t.type}&format=csv`}
                  >
                    {t.label} CSV
                  </Link>
                  <Link
                    className="rounded-md border border-[color:var(--outline)]/40 px-2 py-1.5 text-xs"
                    href={`/api/admin/reports?eventId=${e.id}&type=${t.type}&format=xlsx`}
                  >
                    XLSX
                  </Link>
                </span>
              ))}
            </div>
          </div>
        ))}
        {events.length === 0 ? (
          <p className="text-sm text-[color:var(--muted)]">Ingen arrangementer</p>
        ) : null}
      </div>
    </div>
  );
}
