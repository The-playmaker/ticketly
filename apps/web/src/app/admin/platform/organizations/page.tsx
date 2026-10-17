import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PlatformOrganizationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/platform/organizations");

  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  if (!isSuperAdmin(user)) redirect("/admin");

  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      legalName: true,
      organizationNumber: true,
      isActive: true,
      customerServiceEmail: true,
      createdAt: true,
      _count: { select: { members: true, events: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organisasjoner</h1>
          <p className="text-sm text-[color:var(--muted)]">
            SUPER_ADMIN — plattformorganisasjoner og selger-of-record
          </p>
        </div>
        <Link
          href="/admin/platform/organizations/new"
          className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-[color:var(--accent-foreground)]"
        >
          + Opprett organisasjon
        </Link>
      </div>

      {orgs.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--outline)]/35 bg-[color:var(--surface-container)] p-5 text-sm">
          <p className="text-[color:var(--muted)]">Ingen organisasjoner ennå.</p>
          <Link
            href="/admin/platform/organizations/new"
            className="mt-3 inline-block text-[color:var(--accent-soft)] underline"
          >
            Opprett den første organisasjonen
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[color:var(--outline)]/35">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[color:var(--outline)]/30 bg-[color:var(--surface-low)] text-xs text-[color:var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Navn</th>
                <th className="px-4 py-3 font-medium">Org.nr</th>
                <th className="px-4 py-3 font-medium">Medlemmer</th>
                <th className="px-4 py-3 font-medium">Events</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr
                  key={org.id}
                  className="border-b border-[color:var(--outline)]/20 last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{org.name}</div>
                    <div className="text-xs text-[color:var(--muted)]">
                      {org.legalName ?? org.slug}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {org.organizationNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3">{org._count.members}</td>
                  <td className="px-4 py-3">{org._count.events}</td>
                  <td className="px-4 py-3">
                    {org.isActive ? (
                      <span className="text-emerald-400">Aktiv</span>
                    ) : (
                      <span className="text-[color:var(--muted)]">Inaktiv</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
