import { GlobalRole, InvitationStatus, OrgRole, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { AppError } from "@/lib/api-error";
import {
  consumeAuthActionToken,
  createAuthActionToken,
  generateRawToken,
  hashToken,
} from "@/lib/auth/action-tokens";
import { ORG_OWNER_ROLE } from "@/lib/auth/rbac";
import {
  sendAccountDisabledEmail,
  sendOrganizerInviteEmail,
  sendPasswordResetEmail,
  sendPasswordSetupEmail,
} from "@/lib/email/templates";

const APP_URL = () => process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3456";

export type PlatformUserStatus = "ACTIVE" | "INVITED" | "DISABLED";

export class UserAdminService {
  static async countActiveSuperAdmins(excludeUserId?: string) {
    return prisma.user.count({
      where: {
        globalRole: GlobalRole.SUPER_ADMIN,
        isActive: true,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });
  }

  static async assertNotLastSuperAdmin(targetUserId: string, action: string) {
    const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    if (target.globalRole !== GlobalRole.SUPER_ADMIN || !target.isActive) return;
    const others = await this.countActiveSuperAdmins(targetUserId);
    if (others < 1) {
      throw new AppError(
        "LAST_SUPER_ADMIN",
        `Kan ikke ${action}: dette er den siste aktive SUPER_ADMIN`,
        409
      );
    }
  }

  static async countActiveOrgOwners(organizationId: string, excludeUserId?: string) {
    return prisma.organizationMember.count({
      where: {
        organizationId,
        role: ORG_OWNER_ROLE,
        isActive: true,
        ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      },
    });
  }

  static async assertNotLastOrgOwner(
    organizationId: string,
    targetUserId: string,
    nextRole?: OrgRole | null,
    nextActive?: boolean
  ) {
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    if (!membership || membership.role !== ORG_OWNER_ROLE || !membership.isActive) return;

    const demoting =
      (nextRole != null && nextRole !== ORG_OWNER_ROLE) ||
      nextActive === false ||
      nextRole === null;

    if (!demoting) return;

    const others = await this.countActiveOrgOwners(organizationId, targetUserId);
    if (others < 1) {
      throw new AppError(
        "LAST_ORG_OWNER",
        "Kan ikke fjerne eller nedgradere den siste ORGANIZER_ADMIN i organisasjonen",
        409
      );
    }
  }

  static async listPlatformUsers(params: {
    q?: string;
    status?: PlatformUserStatus | "ALL";
    role?: GlobalRole | "ALL";
    take?: number;
  }) {
    const take = Math.min(params.take ?? 100, 200);
    const q = params.q?.trim();

    const users = await prisma.user.findMany({
      where: {
        ...(params.role && params.role !== "ALL" ? { globalRole: params.role } : {}),
        ...(params.status === "DISABLED" ? { isActive: false } : {}),
        ...(params.status === "ACTIVE" ? { isActive: true, passwordHash: { not: null } } : {}),
        ...(params.status === "INVITED"
          ? {
              OR: [
                { passwordHash: null, isActive: true },
                {
                  email: {
                    in: (
                      await prisma.organizationInvitation.findMany({
                        where: { status: InvitationStatus.PENDING },
                        select: { email: true },
                      })
                    ).map((i) => i.email),
                  },
                },
              ],
            }
          : {}),
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } },
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                {
                  memberships: {
                    some: {
                      organization: { name: { contains: q, mode: "insensitive" } },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        memberships: {
          include: { organization: { select: { id: true, name: true, slug: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    const pendingEmails = new Set(
      (
        await prisma.organizationInvitation.findMany({
          where: {
            status: InvitationStatus.PENDING,
            email: { in: users.map((u) => u.email) },
          },
          select: { email: true },
        })
      ).map((i) => i.email)
    );

    return users.map((u) => {
      let status: PlatformUserStatus = "ACTIVE";
      if (!u.isActive) status = "DISABLED";
      else if (!u.passwordHash || pendingEmails.has(u.email)) status = "INVITED";
      return {
        id: u.id,
        name: (u.name ?? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()) || u.email,
        email: u.email,
        phone: u.phone,
        globalRole: u.globalRole,
        organizations: u.memberships.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
          isActive: m.isActive,
        })),
        lastActiveAt: u.lastActiveAt,
        status,
        createdAt: u.createdAt,
        mfa: "Ikke støttet" as const,
        isActive: u.isActive,
      };
    });
  }

  static async setUserActive(input: {
    actorId: string;
    targetUserId: string;
    isActive: boolean;
    ipAddress?: string | null;
  }) {
    if (input.actorId === input.targetUserId && !input.isActive) {
      await this.assertNotLastSuperAdmin(input.targetUserId, "deaktivere deg selv");
    }
    if (!input.isActive) {
      await this.assertNotLastSuperAdmin(input.targetUserId, "deaktivere");
    }

    const before = await prisma.user.findUniqueOrThrow({ where: { id: input.targetUserId } });
    const user = await prisma.user.update({
      where: { id: input.targetUserId },
      data: { isActive: input.isActive },
    });

    await writeAuditLog({
      actorId: input.actorId,
      action: input.isActive ? "USER_ENABLED" : "USER_DISABLED",
      entityType: "User",
      entityId: user.id,
      metadata: { email: user.email, previousActive: before.isActive },
      ipAddress: input.ipAddress,
    });

    if (!input.isActive && user.email) {
      await sendAccountDisabledEmail({ to: user.email, name: user.name ?? user.email }).catch(
        () => undefined
      );
    }

    return user;
  }

  static async setGlobalRole(input: {
    actorId: string;
    targetUserId: string;
    globalRole: GlobalRole;
    ipAddress?: string | null;
  }) {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: input.targetUserId } });
    if (
      before.globalRole === GlobalRole.SUPER_ADMIN &&
      input.globalRole !== GlobalRole.SUPER_ADMIN
    ) {
      await this.assertNotLastSuperAdmin(input.targetUserId, "fjerne SUPER_ADMIN-rolle");
    }

    const user = await prisma.user.update({
      where: { id: input.targetUserId },
      data: { globalRole: input.globalRole },
    });

    await writeAuditLog({
      actorId: input.actorId,
      action: "ROLE_CHANGED",
      entityType: "User",
      entityId: user.id,
      metadata: {
        scope: "global",
        oldRole: before.globalRole,
        newRole: input.globalRole,
        targetEmail: user.email,
      },
      ipAddress: input.ipAddress,
    });

    return user;
  }

  static async sendPasswordReset(input: {
    actorId?: string | null;
    email: string;
    ipAddress?: string | null;
  }) {
    const email = input.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });

    // Generic response path — always succeed from caller's perspective
    if (!user || !user.isActive) {
      return { ok: true as const };
    }

    const { rawToken } = await createAuthActionToken({
      email,
      purpose: "PASSWORD_RESET",
      userId: user.id,
    });

    const resetUrl = `${APP_URL()}/set-password?token=${encodeURIComponent(rawToken)}&purpose=reset`;
    await sendPasswordResetEmail({ to: email, resetUrl, name: user.name ?? undefined });

    if (input.actorId) {
      await writeAuditLog({
        actorId: input.actorId,
        action: "PASSWORD_RESET_SENT",
        entityType: "User",
        entityId: user.id,
        metadata: { email },
        ipAddress: input.ipAddress,
      });
    }

    return { ok: true as const };
  }

  static async listOrgTeam(organizationId: string) {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            phone: true,
            isActive: true,
            lastActiveAt: true,
            eventAssignments: {
              where: { event: { organizationId } },
              select: { eventId: true, event: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const invites = await prisma.organizationInvitation.findMany({
      where: {
        organizationId,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      members: members.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name:
          (m.user.name ??
            `${m.user.firstName ?? ""} ${m.user.lastName ?? ""}`.trim()) ||
          m.user.email,
        email: m.user.email,
        role: m.role,
        eventAccess: m.user.eventAssignments.map((a) => ({
          id: a.event.id,
          name: a.event.name,
        })),
        status: !m.user.isActive || !m.isActive ? ("DISABLED" as const) : ("ACTIVE" as const),
        membershipActive: m.isActive,
        userActive: m.user.isActive,
        lastActiveAt: m.user.lastActiveAt,
      })),
      invitations: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        expiresAt: i.expiresAt,
        restrictedEventIds: i.restrictedEventIds,
      })),
    };
  }

  static async inviteToOrganization(input: {
    actorId: string;
    organizationId: string;
    email: string;
    role: OrgRole;
    restrictedEventIds?: string[];
    ipAddress?: string | null;
  }) {
    const email = input.email.toLowerCase().trim();
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
    });

    if (input.restrictedEventIds?.length) {
      const count = await prisma.event.count({
        where: {
          id: { in: input.restrictedEventIds },
          organizationId: input.organizationId,
        },
      });
      if (count !== input.restrictedEventIds.length) {
        throw new AppError("INVALID_EVENTS", "Ugyldige arrangementer for denne organisasjonen", 400);
      }
    }

    // Expire prior pending invites for same email+org
    await prisma.organizationInvitation.updateMany({
      where: {
        organizationId: input.organizationId,
        email,
        status: InvitationStatus.PENDING,
      },
      data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
    });

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await prisma.organizationInvitation.create({
      data: {
        organizationId: input.organizationId,
        email,
        role: input.role,
        tokenHash,
        invitedById: input.actorId,
        status: InvitationStatus.PENDING,
        expiresAt,
        restrictedEventIds: input.restrictedEventIds ?? [],
      },
    });

    // Ensure a user shell exists (no password yet)
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          globalRole: GlobalRole.CUSTOMER,
          isActive: true,
        },
      });
    }

    const { rawToken: setupToken } = await createAuthActionToken({
      email,
      purpose: "INVITE_PASSWORD_SETUP",
      userId: user.id,
    });

    const inviteUrl = `${APP_URL()}/set-password?token=${encodeURIComponent(setupToken)}&invite=${encodeURIComponent(rawToken)}`;

    await sendOrganizerInviteEmail({
      to: email,
      organizationName: org.name,
      inviteUrl,
      role: input.role,
    });
    await sendPasswordSetupEmail({
      to: email,
      setupUrl: inviteUrl,
      organizationName: org.name,
    }).catch(() => undefined);

    await writeAuditLog({
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: "USER_INVITED",
      entityType: "OrganizationInvitation",
      entityId: invite.id,
      metadata: {
        email,
        role: input.role,
        restrictedEventIds: input.restrictedEventIds ?? [],
        targetUserId: user.id,
      },
      ipAddress: input.ipAddress,
    });

    return { invite, inviteUrl: process.env.NODE_ENV === "production" ? undefined : inviteUrl };
  }

  static async acceptInviteAndSetPassword(input: {
    inviteToken: string;
    setupToken: string;
    passwordHash: string;
    name?: string;
  }) {
    const inviteHash = hashToken(input.inviteToken);
    const invite = await prisma.organizationInvitation.findUnique({
      where: { tokenHash: inviteHash },
    });
    if (!invite || invite.status !== InvitationStatus.PENDING) {
      throw new AppError("INVITE_INVALID", "Invitasjonen er ugyldig eller allerede brukt", 400);
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      await prisma.organizationInvitation.update({
        where: { id: invite.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new AppError("INVITE_EXPIRED", "Invitasjonen er utløpt", 400);
    }

    const setup = await consumeAuthActionToken({
      rawToken: input.setupToken,
      purpose: "INVITE_PASSWORD_SETUP",
    });
    if (!setup || setup.email !== invite.email) {
      throw new AppError("TOKEN_INVALID", "Oppsettslenken er ugyldig eller utløpt", 400);
    }

    const user = await prisma.user.upsert({
      where: { email: invite.email },
      update: {
        passwordHash: input.passwordHash,
        isActive: true,
        ...(input.name ? { name: input.name } : {}),
      },
      create: {
        email: invite.email,
        passwordHash: input.passwordHash,
        isActive: true,
        name: input.name,
        globalRole: GlobalRole.CUSTOMER,
      },
    });

    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: invite.organizationId,
          userId: user.id,
        },
      },
      update: { role: invite.role, isActive: true },
      create: {
        organizationId: invite.organizationId,
        userId: user.id,
        role: invite.role,
        isActive: true,
      },
    });

    for (const eventId of invite.restrictedEventIds) {
      await prisma.eventAssignment.upsert({
        where: { eventId_userId: { eventId, userId: user.id } },
        update: { role: invite.role },
        create: { eventId, userId: user.id, role: invite.role },
      });
    }

    await prisma.organizationInvitation.update({
      where: { id: invite.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });

    await writeAuditLog({
      actorId: user.id,
      organizationId: invite.organizationId,
      action: "INVITE_ACCEPTED",
      entityType: "OrganizationInvitation",
      entityId: invite.id,
      metadata: { email: invite.email, role: invite.role, userId: user.id },
    });

    await writeAuditLog({
      actorId: invite.invitedById,
      organizationId: invite.organizationId,
      action: "ORG_MEMBER_ADDED",
      entityType: "OrganizationMember",
      entityId: user.id,
      metadata: {
        email: invite.email,
        role: invite.role,
        restrictedEventIds: invite.restrictedEventIds,
      },
    });

    return user;
  }

  static async updateOrgMembership(input: {
    actorId: string;
    organizationId: string;
    userId: string;
    role?: OrgRole;
    isActive?: boolean;
    restrictedEventIds?: string[] | null;
    ipAddress?: string | null;
  }) {
    const before = await prisma.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.userId,
        },
      },
    });

    await this.assertNotLastOrgOwner(
      input.organizationId,
      input.userId,
      input.role ?? before.role,
      input.isActive ?? before.isActive
    );

    const membership = await prisma.organizationMember.update({
      where: { id: before.id },
      data: {
        ...(input.role != null ? { role: input.role } : {}),
        ...(input.isActive != null ? { isActive: input.isActive } : {}),
      },
    });

    if (input.role != null && input.role !== before.role) {
      await writeAuditLog({
        actorId: input.actorId,
        organizationId: input.organizationId,
        action: "ROLE_CHANGED",
        entityType: "OrganizationMember",
        entityId: membership.id,
        metadata: {
          targetUserId: input.userId,
          oldRole: before.role,
          newRole: input.role,
        },
        ipAddress: input.ipAddress,
      });
    }

    if (input.restrictedEventIds !== undefined) {
      const nextIds = input.restrictedEventIds ?? [];
      if (nextIds.length) {
        const count = await prisma.event.count({
          where: {
            id: { in: nextIds },
            organizationId: input.organizationId,
          },
        });
        if (count !== nextIds.length) {
          throw new AppError(
            "INVALID_EVENTS",
            "Ugyldige arrangementer for denne organisasjonen",
            400
          );
        }
      }

      const existing = await prisma.eventAssignment.findMany({
        where: {
          userId: input.userId,
          event: { organizationId: input.organizationId },
        },
      });
      const next = new Set(nextIds);
      for (const row of existing) {
        if (!next.has(row.eventId)) {
          await prisma.eventAssignment.delete({ where: { id: row.id } });
        }
      }
      for (const eventId of next) {
        await prisma.eventAssignment.upsert({
          where: { eventId_userId: { eventId, userId: input.userId } },
          update: { role: membership.role },
          create: {
            eventId,
            userId: input.userId,
            role: membership.role,
          },
        });
      }
      await writeAuditLog({
        actorId: input.actorId,
        organizationId: input.organizationId,
        action: "EVENT_ACCESS_CHANGED",
        entityType: "User",
        entityId: input.userId,
        metadata: {
          restrictedEventIds: input.restrictedEventIds,
          previousEventIds: existing.map((e) => e.eventId),
        },
        ipAddress: input.ipAddress,
      });
    }

    return membership;
  }

  static async removeFromOrganization(input: {
    actorId: string;
    organizationId: string;
    userId: string;
    ipAddress?: string | null;
  }) {
    await this.assertNotLastOrgOwner(input.organizationId, input.userId, null, false);

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.userId,
        },
      },
    });
    if (!membership) {
      throw new AppError("NOT_FOUND", "Medlem ikke funnet", 404);
    }

    await prisma.eventAssignment.deleteMany({
      where: {
        userId: input.userId,
        event: { organizationId: input.organizationId },
      },
    });

    await prisma.organizationMember.delete({ where: { id: membership.id } });

    await writeAuditLog({
      actorId: input.actorId,
      organizationId: input.organizationId,
      action: "ORG_MEMBER_REMOVED",
      entityType: "OrganizationMember",
      entityId: membership.id,
      metadata: {
        targetUserId: input.userId,
        oldRole: membership.role,
      },
      ipAddress: input.ipAddress,
    });

    // Global user is preserved
    return { ok: true as const };
  }

  static async listAuditForUser(userId: string, take = 50) {
    return prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: "User", entityId: userId },
          { actorId: userId },
          {
            metadata: {
              path: ["targetUserId"],
              equals: userId,
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        actor: { select: { id: true, email: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
    });
  }

  static async updateOrganizationSeller(
    organizationId: string,
    data: Prisma.OrganizationUpdateInput,
    actorId: string
  ) {
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data,
    });
    await writeAuditLog({
      actorId,
      organizationId,
      action: "ORG_SELLER_UPDATED",
      entityType: "Organization",
      entityId: organizationId,
      metadata: data as object,
    });
    return org;
  }
}
