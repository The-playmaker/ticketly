import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveOrgIdForUser } from "@/lib/admin/org-access";
import { canManageTeam, isSuperAdmin } from "@/lib/auth/rbac";
import { UserAdminService } from "@/services/user-admin-service";
import { prisma } from "@/lib/db";
import { TeamAdminClient } from "@/components/admin/team-admin-client";
import { NoOrganizationPanel } from "@/components/admin/no-organization-panel";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/settings/team");

  const user = {
    id: session.user.id,
    email: session.user.email!,
    globalRole: session.user.globalRole,
    isActive: session.user.isActive !== false,
    memberships: session.user.memberships,
  };

  const orgId = await resolveOrgIdForUser(user.id, user.globalRole);
  if (!orgId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Team</h1>
        <NoOrganizationPanel showCreateCta={isSuperAdmin(user)} />
      </div>
    );
  }

  if (!canManageTeam(user, orgId) && !isSuperAdmin(user)) {
    redirect("/admin");
  }

  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  const team = await UserAdminService.listOrgTeam(orgId);
  const events = await prisma.event.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
    orderBy: { startsAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-[color:var(--muted)]">
          {org?.name ?? "Organisasjon"} — inviter, roller og eventtilgang. Fjerner ikke globale
          brukere.
        </p>
      </div>
      <TeamAdminClient
        organizationId={orgId}
        members={team.members}
        invitations={team.invitations}
        events={events}
      />
    </div>
  );
}
