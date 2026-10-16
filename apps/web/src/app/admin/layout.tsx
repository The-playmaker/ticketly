import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { canAccessAdmin, isSuperAdmin } from "@/lib/auth/rbac";
import { formatMoney } from "@/lib/utils";
import { EventService } from "@/services/event-service";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const nav = [
  { href: "/admin", label: "Oversikt" },
  { href: "/admin/events", label: "Arrangementer" },
  { href: "/admin/orders", label: "Ordrer / Support" },
  { href: "/admin/promos", label: "Kampanjekoder" },
  { href: "/admin/reports", label: "Analyse" },
  { href: "/admin/webhooks", label: "Webhooks" },
  { href: "/admin/settings", label: "Innstillinger" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin");

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    globalRole: session.user.globalRole,
    isActive: true,
    memberships: session.user.memberships,
  };

  if (!canAccessAdmin(user)) redirect("/");

  const platform = isSuperAdmin(user);

  return (
    <div className="min-h-dvh bg-[color:var(--background)] text-foreground">
      <div className="mx-auto flex min-h-dvh max-w-[1440px]">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-[color:var(--outline)]/30 bg-[color:var(--surface-low)] md:flex">
          <div className="border-b border-[color:var(--outline)]/25 px-4 py-5">
            <Link
              href="/admin"
              className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-foreground"
            >
              Ticketly Admin
            </Link>
            <p className="mt-1 truncate text-xs text-[color:var(--muted)]">{session.user.email}</p>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-3 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-[color:var(--muted)] transition hover:bg-[color:var(--surface-high)] hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            {platform ? (
              <Link
                href="/admin/platform/payments/diagnostics"
                className="rounded-md px-3 py-2 text-[color:var(--accent-soft)] transition hover:bg-[color:var(--surface-high)]"
              >
                Platform
              </Link>
            ) : null}
            <div className="mt-auto space-y-2 pt-6">
              <Link
                href="/scan"
                className="flex items-center justify-center rounded-md bg-[color:var(--accent)] px-3 py-2.5 text-sm font-semibold text-[color:var(--accent-foreground)]"
              >
                Åpne dørskanner
              </Link>
              <Link
                href="/"
                className="block px-3 py-2 text-xs text-[color:var(--muted)] hover:text-foreground"
              >
                ← Butikk
              </Link>
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-3 border-b border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] px-4 md:px-6">
            <div className="flex items-center gap-3 md:hidden">
              <Link href="/admin" className="font-display text-sm font-semibold uppercase tracking-wider">
                Ticketly
              </Link>
            </div>
            <div className="hidden items-center gap-2 text-xs text-[color:var(--muted)] sm:flex">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
                LIVE
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="muted" className="hidden sm:inline-flex">
                {session.user.email}
              </Badge>
              <Link
                href="/admin/events/new"
                className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-[color:var(--accent-foreground)]"
              >
                + Opprett
              </Link>
            </div>
          </header>

          <nav className="flex gap-1 overflow-x-auto border-b border-[color:var(--outline)]/25 px-3 py-2 text-xs md:hidden">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[color:var(--muted)] hover:bg-[color:var(--surface-high)] hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/scan"
              className="whitespace-nowrap rounded-md bg-[color:var(--accent)] px-2.5 py-1.5 font-semibold text-[color:var(--accent-foreground)]"
            >
              Scanner
            </Link>
          </nav>

          <main className="flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

export async function getAdminOrgId(userId: string, globalRole: string) {
  if (globalRole === "SUPER_ADMIN") {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    return org?.id ?? null;
  }
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, isActive: true },
  });
  return membership?.organizationId ?? null;
}

export async function getOrgStatsForUser(userId: string, globalRole: string) {
  const orgId = await getAdminOrgId(userId, globalRole);
  if (!orgId) return null;
  return EventService.getOrgDashboardStats(orgId);
}

export { formatMoney };
