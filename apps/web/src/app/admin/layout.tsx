import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/auth/rbac";
import { formatMoney } from "@/lib/utils";
import { EventService } from "@/services/event-service";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

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

  return (
    <div className="min-h-dvh bg-zinc-100 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-semibold tracking-tight">
              Ticketly Admin
            </Link>
            <nav className="hidden gap-4 text-sm text-zinc-600 md:flex">
              <Link href="/admin" className="hover:text-zinc-900">
                Oversikt
              </Link>
              <Link href="/admin/events" className="hover:text-zinc-900">
                Arrangementer
              </Link>
              <Link href="/admin/orders" className="hover:text-zinc-900">
                Ordrer
              </Link>
              <Link href="/admin/webhooks" className="hover:text-zinc-900">
                Webhooks
              </Link>
              <Link href="/admin/reports" className="hover:text-zinc-900">
                Rapporter
              </Link>
              <Link href="/admin/settings" className="hover:text-zinc-900">
                Innstillinger
              </Link>
              <Link href="/scan" className="hover:text-zinc-900">
                Scanner
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Badge variant="muted">{session.user.email}</Badge>
            <Link href="/" className="text-zinc-500 hover:text-zinc-800">
              Butikk
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
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
