import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient, GlobalRole, OrgRole, InvitationStatus } from "@prisma/client";
import { generateRawToken, hashToken } from "@/lib/auth/action-tokens";
import { hashPassword } from "@/lib/auth/password";
import { UserAdminService } from "@/services/user-admin-service";

const prisma = new PrismaClient();
const runDb = Boolean(process.env.DATABASE_URL);

describe.runIf(runDb)("Invite + auth flows (DB)", () => {
  const suffix = Date.now().toString(36);
  let orgId: string;
  let actorId: string;
  const inviteEmail = `invite-${suffix}@test.local`;

  beforeAll(async () => {
    const actor = await prisma.user.create({
      data: {
        email: `actor-${suffix}@test.local`,
        globalRole: GlobalRole.SUPER_ADMIN,
        isActive: true,
        passwordHash: await hashPassword("test-password-ok"),
        name: "Actor",
      },
    });
    actorId = actor.id;
    const org = await prisma.organization.create({
      data: {
        name: `Test Org ${suffix}`,
        slug: `test-org-${suffix}`,
        legalName: `Test Org AS ${suffix}`,
        organizationNumber: "111222333",
        customerServiceEmail: "support@test.local",
        refundPolicyText: "Test policy",
        termsVersion: "1.0",
      },
    });
    orgId = org.id;
    await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: actorId,
        role: OrgRole.ORGANIZER_ADMIN,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.organizationInvitation.deleteMany({ where: { organizationId: orgId } });
    await prisma.eventAssignment.deleteMany({
      where: { event: { organizationId: orgId } },
    });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({
      where: { email: { in: [inviteEmail, `actor-${suffix}@test.local`] } },
    });
    await prisma.authActionToken.deleteMany({
      where: { email: { in: [inviteEmail, `actor-${suffix}@test.local`] } },
    });
    await prisma.$disconnect();
  });

  it("invites user and accepts with password setup", async () => {
    const result = await UserAdminService.inviteToOrganization({
      actorId,
      organizationId: orgId,
      email: inviteEmail,
      role: OrgRole.DOOR_STAFF,
    });
    expect(result.invite.status).toBe(InvitationStatus.PENDING);

    const invite = await prisma.organizationInvitation.findUniqueOrThrow({
      where: { id: result.invite.id },
    });
    // We cannot recover raw invite token from DB — create a controlled accept path
    const rawInvite = generateRawToken();
    await prisma.organizationInvitation.update({
      where: { id: invite.id },
      data: { tokenHash: hashToken(rawInvite) },
    });

    const { createAuthActionToken } = await import("@/lib/auth/action-tokens");
    const setup = await createAuthActionToken({
      email: inviteEmail,
      purpose: "INVITE_PASSWORD_SETUP",
    });

    const user = await UserAdminService.acceptInviteAndSetPassword({
      inviteToken: rawInvite,
      setupToken: setup.rawToken,
      passwordHash: await hashPassword("invitee-strong-password"),
      name: "Invitee",
    });

    expect(user.email).toBe(inviteEmail);
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
    });
    expect(membership?.role).toBe(OrgRole.DOOR_STAFF);
    expect(membership?.isActive).toBe(true);

    const accepted = await prisma.organizationInvitation.findUniqueOrThrow({
      where: { id: invite.id },
    });
    expect(accepted.status).toBe(InvitationStatus.ACCEPTED);
  });

  it("rejects expired invite", async () => {
    const email = `expired-${suffix}@test.local`;
    const raw = generateRawToken();
    await prisma.organizationInvitation.create({
      data: {
        organizationId: orgId,
        email,
        role: OrgRole.EVENT_MANAGER,
        tokenHash: hashToken(raw),
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000),
        invitedById: actorId,
      },
    });
    const { createAuthActionToken } = await import("@/lib/auth/action-tokens");
    const setup = await createAuthActionToken({
      email,
      purpose: "INVITE_PASSWORD_SETUP",
    });

    await expect(
      UserAdminService.acceptInviteAndSetPassword({
        inviteToken: raw,
        setupToken: setup.rawToken,
        passwordHash: await hashPassword("another-strong-pw"),
      })
    ).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
  });

  it("prevents disabling last active SUPER_ADMIN", async () => {
    const others = await UserAdminService.countActiveSuperAdmins(actorId);
    if (others >= 1) {
      // Seeded environments may have another SUPER_ADMIN — demote actor role instead
      await expect(
        UserAdminService.setGlobalRole({
          actorId,
          targetUserId: actorId,
          globalRole: GlobalRole.CUSTOMER,
        })
      ).resolves.toBeTruthy();
      // restore for later tests
      await prisma.user.update({
        where: { id: actorId },
        data: { globalRole: GlobalRole.SUPER_ADMIN },
      });
      return;
    }
    await expect(
      UserAdminService.setUserActive({
        actorId,
        targetUserId: actorId,
        isActive: false,
      })
    ).rejects.toMatchObject({ code: "LAST_SUPER_ADMIN" });
  });

  it("prevents removing last ORGANIZER_ADMIN", async () => {
    await expect(
      UserAdminService.removeFromOrganization({
        actorId,
        organizationId: orgId,
        userId: actorId,
      })
    ).rejects.toMatchObject({ code: "LAST_ORG_OWNER" });
  });

  it("role update audits ROLE_CHANGED", async () => {
    const member = await prisma.user.create({
      data: {
        email: `member-${suffix}@test.local`,
        globalRole: GlobalRole.CUSTOMER,
        isActive: true,
        passwordHash: await hashPassword("member-strong-pw"),
      },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.id,
        role: OrgRole.EVENT_MANAGER,
        isActive: true,
      },
    });

    await UserAdminService.updateOrgMembership({
      actorId,
      organizationId: orgId,
      userId: member.id,
      role: OrgRole.DOOR_STAFF,
    });

    const log = await prisma.auditLog.findFirst({
      where: {
        action: "ROLE_CHANGED",
        organizationId: orgId,
        entityType: "OrganizationMember",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toBeTruthy();

    await prisma.organizationMember.deleteMany({ where: { userId: member.id } });
    await prisma.user.delete({ where: { id: member.id } });
  });

  it("editing existing member event assignments works", async () => {
    const member = await prisma.user.create({
      data: {
        email: `door-assign-${suffix}@test.local`,
        globalRole: GlobalRole.CUSTOMER,
        isActive: true,
        passwordHash: await hashPassword("door-assign-strong-pw"),
      },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.id,
        role: OrgRole.DOOR_STAFF,
        isActive: true,
      },
    });

    const starts = new Date(Date.now() + 86400000);
    const ends = new Date(Date.now() + 90000000);
    const e1 = await prisma.event.create({
      data: {
        organizationId: orgId,
        sellerOrganizationId: orgId,
        name: `Door Event A ${suffix}`,
        slug: `door-a-${suffix}`,
        capacity: 100,
        startsAt: starts,
        endsAt: ends,
      },
    });
    const e2 = await prisma.event.create({
      data: {
        organizationId: orgId,
        sellerOrganizationId: orgId,
        name: `Door Event B ${suffix}`,
        slug: `door-b-${suffix}`,
        capacity: 100,
        startsAt: starts,
        endsAt: ends,
      },
    });

    await UserAdminService.updateOrgMembership({
      actorId,
      organizationId: orgId,
      userId: member.id,
      restrictedEventIds: [e1.id],
    });

    let assignments = await prisma.eventAssignment.findMany({
      where: { userId: member.id },
    });
    expect(assignments.map((a) => a.eventId)).toEqual([e1.id]);

    await UserAdminService.updateOrgMembership({
      actorId,
      organizationId: orgId,
      userId: member.id,
      restrictedEventIds: [e2.id],
    });
    assignments = await prisma.eventAssignment.findMany({
      where: { userId: member.id },
    });
    expect(assignments.map((a) => a.eventId).sort()).toEqual([e2.id]);

    await UserAdminService.updateOrgMembership({
      actorId,
      organizationId: orgId,
      userId: member.id,
      restrictedEventIds: [],
    });
    assignments = await prisma.eventAssignment.findMany({
      where: { userId: member.id },
    });
    expect(assignments).toEqual([]);

    const accessLog = await prisma.auditLog.findFirst({
      where: {
        action: "EVENT_ACCESS_CHANGED",
        organizationId: orgId,
        entityId: member.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(accessLog).toBeTruthy();

    // listOrgTeam surfaces the assignment (incl. after re-assign)
    await UserAdminService.updateOrgMembership({
      actorId,
      organizationId: orgId,
      userId: member.id,
      restrictedEventIds: [e1.id],
    });
    const team = await UserAdminService.listOrgTeam(orgId);
    const teamMember = team.members.find((m) => m.userId === member.id);
    expect(teamMember?.eventAccess.map((e) => e.id)).toEqual([e1.id]);
    expect(teamMember?.eventAccess[0]?.status).toBeTruthy();

    // PAUSED event remains visible to scanner diagnostic / assignment filter
    await prisma.event.update({
      where: { id: e1.id },
      data: { status: "PAUSED" },
    });
    const diag = await UserAdminService.diagnoseScannerAccess({
      userId: member.id,
      organizationId: orgId,
    });
    expect(diag.user.email).toBe(member.email);
    expect(diag.memberships.some((m) => m.role === OrgRole.DOOR_STAFF)).toBe(true);
    expect(diag.eventAssignments).toHaveLength(1);
    expect(diag.eventAssignments[0]?.eventStatus).toBe("PAUSED");
    expect(diag.eventAssignments[0]?.scannerAccess).toBe("allowed");
    expect(diag.scannerAccess).toBe("allowed");
    expect(diag.scannerVisibleEvents.map((e) => e.id)).toContain(e1.id);

    // No assignment ⇒ denied
    await UserAdminService.updateOrgMembership({
      actorId,
      organizationId: orgId,
      userId: member.id,
      restrictedEventIds: [],
    });
    const empty = await UserAdminService.diagnoseScannerAccess({
      email: member.email,
      organizationId: orgId,
    });
    expect(empty.scannerAccess).toBe("denied");
    expect(empty.scannerVisibleEvents).toEqual([]);

    await prisma.eventAssignment.deleteMany({ where: { userId: member.id } });
    await prisma.event.deleteMany({ where: { id: { in: [e1.id, e2.id] } } });
    await prisma.organizationMember.deleteMany({ where: { userId: member.id } });
    await prisma.user.delete({ where: { id: member.id } });
  });
});
