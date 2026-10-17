import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { CreateOrganizationForm } from "@/components/admin/create-organization-form";

export const dynamic = "force-dynamic";

export default async function NewPlatformOrganizationPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/admin/platform/organizations/new");
  }

  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  if (!isSuperAdmin(user)) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/platform/organizations"
          className="text-xs text-[color:var(--muted)] hover:text-foreground"
        >
          ← Organisasjoner
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Opprett organisasjon</h1>
        <p className="text-sm text-[color:var(--muted)]">
          SUPER_ADMIN — opprett første (eller neste) selgerorganisasjon
        </p>
      </div>
      <CreateOrganizationForm />
    </div>
  );
}
