import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalRole, OrgRole } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";

const { findUnique, update } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique,
      update,
    },
  },
}));

import { authorizeCredentials } from "@/lib/auth/credentials-authorize";
import { refreshAuthJwt } from "@/lib/auth/jwt-refresh";

const memberships = [
  {
    organizationId: "org-1",
    role: OrgRole.ORGANIZER_ADMIN,
    canRefund: true,
    isActive: true,
  },
];

describe("auth hot path — no lastActiveAt writes", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("authenticates a valid user without calling User.update", async () => {
    const passwordHash = await hashPassword("correct-horse-battery");
    findUnique.mockResolvedValue({
      id: "user-1",
      email: "organizer@example.com",
      name: "Org User",
      firstName: "Org",
      lastName: "User",
      image: null,
      passwordHash,
      globalRole: GlobalRole.CUSTOMER,
      isActive: true,
      memberships,
    });

    const result = await authorizeCredentials({
      email: "organizer@example.com",
      password: "correct-horse-battery",
    });

    expect(result).toMatchObject({
      id: "user-1",
      email: "organizer@example.com",
      globalRole: GlobalRole.CUSTOMER,
      isActive: true,
      memberships,
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects disabled users without writing activity", async () => {
    const passwordHash = await hashPassword("correct-horse-battery");
    findUnique.mockResolvedValue({
      id: "user-off",
      email: "off@example.com",
      name: "Off",
      firstName: null,
      lastName: null,
      image: null,
      passwordHash,
      globalRole: GlobalRole.CUSTOMER,
      isActive: false,
      memberships: [],
    });

    const result = await authorizeCredentials({
      email: "off@example.com",
      password: "correct-horse-battery",
    });

    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects wrong password without writing activity", async () => {
    const passwordHash = await hashPassword("correct-horse-battery");
    findUnique.mockResolvedValue({
      id: "user-1",
      email: "organizer@example.com",
      name: "Org User",
      firstName: null,
      lastName: null,
      image: null,
      passwordHash,
      globalRole: GlobalRole.CUSTOMER,
      isActive: true,
      memberships,
    });

    const result = await authorizeCredentials({
      email: "organizer@example.com",
      password: "wrong-password",
    });

    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("JWT refresh performs no activity write and refreshes RBAC", async () => {
    findUnique.mockResolvedValue({
      id: "user-1",
      globalRole: GlobalRole.SUPER_ADMIN,
      isActive: true,
      memberships: [
        {
          organizationId: "org-2",
          role: OrgRole.EVENT_MANAGER,
          canRefund: false,
          isActive: true,
        },
      ],
    });

    const next = await refreshAuthJwt({
      id: "user-1",
      globalRole: GlobalRole.CUSTOMER,
      isActive: true,
      memberships,
    });

    expect(next).toEqual({
      id: "user-1",
      globalRole: GlobalRole.SUPER_ADMIN,
      isActive: true,
      disabled: false,
      memberships: [
        {
          organizationId: "org-2",
          role: OrgRole.EVENT_MANAGER,
          canRefund: false,
          isActive: true,
        },
      ],
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      include: {
        memberships: {
          where: { isActive: true },
          select: {
            organizationId: true,
            role: true,
            canRefund: true,
            isActive: true,
          },
        },
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("JWT refresh clears session fields for disabled users without writes", async () => {
    findUnique.mockResolvedValue({
      id: "user-1",
      globalRole: GlobalRole.CUSTOMER,
      isActive: false,
      memberships: [],
    });

    const next = await refreshAuthJwt({
      id: "user-1",
      globalRole: GlobalRole.CUSTOMER,
      isActive: true,
      memberships,
    });

    expect(next).toMatchObject({
      id: undefined,
      disabled: true,
      isActive: false,
      memberships: [],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("seeds JWT from login user then refreshes memberships without writes", async () => {
    findUnique.mockResolvedValue({
      id: "user-1",
      globalRole: GlobalRole.CUSTOMER,
      isActive: true,
      memberships,
    });

    const next = await refreshAuthJwt(
      {},
      {
        id: "user-1",
        globalRole: GlobalRole.CUSTOMER,
        isActive: true,
        memberships: [],
      }
    );

    expect(next.id).toBe("user-1");
    expect(next.memberships).toEqual(memberships);
    expect(next.disabled).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
