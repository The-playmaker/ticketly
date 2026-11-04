import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalRole } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import {
  MemoryRateLimitProvider,
  setRateLimitProvider,
} from "@/lib/security/rate-limit";

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique },
  },
}));

import { authorizeCredentials } from "@/lib/auth/credentials-authorize";

describe("credentials authorize rate limit", () => {
  const email = "login-rl@example.com";
  const password = "correct-horse-battery";
  let passwordHash: string;

  beforeEach(async () => {
    findUnique.mockReset();
    setRateLimitProvider(new MemoryRateLimitProvider());
    passwordHash = await hashPassword(password);
    findUnique.mockResolvedValue({
      id: "user-rl",
      email,
      name: "RL User",
      firstName: "RL",
      lastName: "User",
      image: null,
      passwordHash,
      globalRole: GlobalRole.CUSTOMER,
      isActive: true,
      memberships: [],
    });
  });

  it("returns null on 11th correct-password attempt for same email (10/15min)", async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await authorizeCredentials(
        { email, password },
        { ip: `ip-distinct-${i}` }
      );
      expect(ok).not.toBeNull();
      expect(ok?.id).toBe("user-rl");
    }

    const blocked = await authorizeCredentials(
      { email, password },
      { ip: "ip-distinct-11" }
    );
    expect(blocked).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(10);
  });

  it("returns null after 30 attempts from same IP across emails", async () => {
    for (let i = 0; i < 30; i++) {
      findUnique.mockResolvedValueOnce({
        id: `user-${i}`,
        email: `u${i}@example.com`,
        name: null,
        firstName: null,
        lastName: null,
        image: null,
        passwordHash,
        globalRole: GlobalRole.CUSTOMER,
        isActive: true,
        memberships: [],
      });
      const ok = await authorizeCredentials(
        { email: `u${i}@example.com`, password },
        { ip: "same-ip" }
      );
      expect(ok).not.toBeNull();
    }

    const blocked = await authorizeCredentials(
      { email: "extra@example.com", password },
      { ip: "same-ip" }
    );
    expect(blocked).toBeNull();
  });
});
