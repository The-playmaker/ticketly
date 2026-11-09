import { redirect } from "next/navigation";
import Link from "next/link";
import { canAccessAdmin, isSuperAdmin } from "@/lib/auth/rbac";
import { requireAdminPageSession } from "@/lib/auth/session";
import { isDoorStaffOnly } from "@/lib/auth/event-access";
import { formatMoney } from "@/lib/utils";
import { EventService } from "@/services/event-service";
import { getAdminOrgId, resolveOrgScopeForUser } from "@/lib/admin/org-access";
import { Badge } from "@/components/ui/badge";
import { OrgContextSwitcher } from "@/components/admin/org-context-switcher";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";

export const dynamic = "force-dynamic";

const fullNav = [
  { href: "/admin", label: "Oversikt" },
  { href: "/admin/events", label: "Arrangementer" },
  { href: "/admin/orders", label: "Ordrer / Support" },
  { href: "/admin/promos", label: "Kampanjekoder" },
  { href: "/admin/promoters", label: "Promotører" },
  { href: "/admin/reports", label: "Analyse" },
  { href: "/admin/webhooks", label: "Webhooks" },
  { href: "/admin/settings", label: "Innstillinger" },
  { href: "/admin/settings/team", label: "Team" },
];

const platformNav = [
  { href: "/admin/platform/organizations", label: "Organisasjoner" },
  { href: "/admin/platform/users", label: "Plattformbrukere" },
  { href: "/admin/platform/readiness", label: "Readiness" },
  { href: "/admin/platform/payments/diagnostics", label: "Betaling" },
  { href: "/admin/platform/payments/reconciliation", label: "Reconcile" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPageSession("/admin");

  if (!canAccessAdmin(user)) redirect("/");

  // DOOR_STAFF-only: no admin console — scanner only
  if (isDoorStaffOnly(user)) {
    redirect("/scan");
  }

  const platform = isSuperAdmin(user);
  const nav = fullNav;
  const email = user.email ?? "";
  const orgScope = platform
    ? await resolveOrgScopeForUser(user.id, user.globalRole)
    : null;

  const navLinkClass =
    "rounded-md px-3 py-2 text-[color:var(--muted)] transition hover:bg-[color:var(--surface-high)] hover:text-foreground";

  return (
    <div className="min-h-dvh bg-[color:var(--background)] text-foreground">
      <div className="mx-auto flex min-h-dvh max-w-[1440px]">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-[color:var(--outline)]/30 bg-[color:var(--surface-low)] md:flex lg:w-64">
          <div className="border-b border-[color:var(--outline)]/25 px-4 py-5">
            <Link
              href="/admin"
              className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-foreground"
            >
              Ticketly Admin
            </Link>
            <p className="mt-1 truncate text-xs text-[color:var(--muted)]">{email}</p>
            {platform && orgScope ? (
              <div className="mt-3">
                <OrgContextSwitcher
                  organizations={orgScope.organizations}
                  selectedOrganizationId={orgScope.organizationId}
                  mode={orgScope.mode === "none" ? "global" : orgScope.mode}
                  allowGlobal
                />
              </div>
            ) : null}
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 p-3 text-sm" aria-label="Admin">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className={navLinkClass}>
                {item.label}
              </Link>
            ))}
            {platform ? (
              <div className="mt-3 space-y-0.5 border-t border-[color:var(--outline)]/20 pt-3">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  Plattform
                </p>
                {platformNav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-2 text-[color:var(--accent-soft)] transition hover:bg-[color:var(--surface-high)]"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="mt-auto space-y-2 pt-6">
              <Link
                href="/scan"
                className="flex items-center justify-center rounded-md bg-[color:var(--accent)] px-3 py-2.5 text-sm font-semibold text-[color:var(--accent-foreground)] transition hover:brightness-110"
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
          <header className="flex h-14 items-center justify-between gap-3 border-b border-[color:var(--outline)]/30 bg-[color:var(--surface-container)] px-3 sm:px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-2 md:hidden">
              <AdminMobileNav
                nav={nav}
                platformNav={platform ? platformNav : []}
                email={email}
              />
              <Link
                href="/admin"
                className="truncate font-display text-sm font-semibold uppercase tracking-wider"
              >
                Ticketly
              </Link>
              {platform && orgScope ? (
                <div className="min-w-0 max-w-[9rem] sm:max-w-none">
                  <OrgContextSwitcher
                    organizations={orgScope.organizations}
                    selectedOrganizationId={orgScope.organizationId}
                    mode={orgScope.mode === "none" ? "global" : orgScope.mode}
                    allowGlobal
                  />
                </div>
              ) : null}
            </div>
            <div className="hidden items-center gap-2 text-xs text-[color:var(--muted)] sm:flex md:flex">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
                LIVE
              </span>
              {platform && orgScope?.mode === "global" ? (
                <span className="text-[color:var(--accent-soft)]">Global</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="muted" className="hidden max-w-[12rem] truncate lg:inline-flex">
                {email}
              </Badge>
              <Link
                href="/admin/events/new"
                className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-[color:var(--accent-foreground)] transition hover:brightness-110"
              >
                + Opprett
              </Link>
            </div>
          </header>

          <nav
            className="flex gap-1 overflow-x-auto border-b border-[color:var(--outline)]/25 px-2 py-2 text-xs scrollbar-thin md:hidden"
            aria-label="Admin mobil"
          >
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-2.5 py-2 text-[color:var(--muted)] hover:bg-[color:var(--surface-high)] hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/scan"
              className="whitespace-nowrap rounded-md bg-[color:var(--accent)] px-2.5 py-2 font-semibold text-[color:var(--accent-foreground)]"
            >
              Scanner
            </Link>
          </nav>

          <main className="min-w-0 flex-1 px-3 py-5 sm:px-4 sm:py-6 md:px-6 md:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

export { getAdminOrgId };

export async function getOrgStatsForUser(userId: string, globalRole: string) {
  const scope = await resolveOrgScopeForUser(userId, globalRole);
  if (scope.isPlatformAdmin && scope.mode === "global") {
    return EventService.getOrgDashboardStats(null);
  }
  if (!scope.organizationId) return null;
  return EventService.getOrgDashboardStats(scope.organizationId);
}

export { formatMoney };
