import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { EditOrganizationForm } from "@/components/admin/edit-organization-form";

export const dynamic = "force-dynamic";

export default async function EditPlatformOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/admin/platform/organizations/${id}`);
  }

  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };
  if (!isSuperAdmin(user)) redirect("/admin");

  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/platform/organizations"
          className="text-xs text-[color:var(--muted)] hover:text-foreground"
        >
          ← Organisasjoner
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-[color:var(--muted)]">
          SUPER_ADMIN — rediger selgerfelter og aktiv/inaktiv status
        </p>
      </div>
      <EditOrganizationForm org={org} />
    </div>
  );
}
