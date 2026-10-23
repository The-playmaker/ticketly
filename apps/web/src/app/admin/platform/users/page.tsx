import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { UserAdminService } from "@/services/user-admin-service";
import { PlatformUsersClient } from "@/components/admin/platform-users-client";
import { ScannerAccessDiagnostic } from "@/components/admin/scanner-access-diagnostic";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ q?: string; status?: string; role?: string }>;
};

export default async function PlatformUsersPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/platform/users");

  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  if (!isSuperAdmin(user)) redirect("/admin");

  const sp = await searchParams;
  const status = (sp.status ?? "ALL") as "ALL" | "ACTIVE" | "INVITED" | "DISABLED";
  const role = (sp.role ?? "ALL") as "ALL" | "SUPER_ADMIN" | "CUSTOMER";
  const users = await UserAdminService.listPlatformUsers({
    q: sp.q,
    status,
    role,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Plattformbrukere</h1>
          <p className="text-sm text-[color:var(--muted)]">
            SUPER_ADMIN — administrer globale brukere. Preferer deaktivering fremfor sletting.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            href="/admin/platform/readiness"
            className="rounded-md border border-[color:var(--outline)]/40 px-3 py-1.5 hover:bg-[color:var(--surface-high)]"
          >
            Readiness
          </Link>
          <Link
            href="/admin/platform/payments/diagnostics"
            className="rounded-md border border-[color:var(--outline)]/40 px-3 py-1.5 hover:bg-[color:var(--surface-high)]"
          >
            Betaling
          </Link>
        </div>
      </div>
      <PlatformUsersClient
        initialUsers={users}
        initialQ={sp.q ?? ""}
        initialStatus={status}
        initialRole={role}
      />
      <ScannerAccessDiagnostic />
    </div>
  );
}
