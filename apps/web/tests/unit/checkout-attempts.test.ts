import { beforeEach, describe, expect, it, vi } from "vitest";

const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { order: { count } } }));

import { assertCheckoutAttemptsAllowed } from "@/lib/security/checkout-attempts";

function mockCounts(declined: number, unpaid: number) {
  count.mockImplementation((args?: { where?: { paymentStatus?: { in?: string[] } } }) =>
    Promise.resolve(args?.where?.paymentStatus?.in?.includes("PENDING") ? unpaid : declined)
  );
}

describe("checkout attempt limiter", () => {
  beforeEach(() => count.mockReset());

  it("allows a normal buyer", async () => {
    mockCounts(1, 2);
    await expect(assertCheckoutAttemptsAllowed("a@b.no")).resolves.toBeUndefined();
  });

  it("blocks after 3 declined/blocked payments in an hour", async () => {
    mockCounts(3, 3);
    await expect(assertCheckoutAttemptsAllowed("a@b.no")).rejects.toMatchObject({
      code: "CHECKOUT_TOO_MANY_DECLINES",
      status: 429,
    });
  });

  it("blocks after 8 unpaid attempts in an hour", async () => {
    mockCounts(0, 8);
    await expect(assertCheckoutAttemptsAllowed("a@b.no")).rejects.toMatchObject({
      code: "CHECKOUT_TOO_MANY_ATTEMPTS",
    });
  });

  it("matches e-mail case-insensitively within the last hour", async () => {
    mockCounts(0, 0);
    await assertCheckoutAttemptsAllowed(" Iselin@Example.com ");
    const where = count.mock.calls[0]![0].where;
    expect(where.customerEmail).toEqual({ equals: "Iselin@Example.com", mode: "insensitive" });
    expect(Date.now() - where.createdAt.gte.getTime()).toBeLessThanOrEqual(3_600_000 + 1000);
  });
});
