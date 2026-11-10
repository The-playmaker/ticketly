import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  access: vi.fn(),
  orgFind: vi.fn(),
  ticketFind: vi.fn(),
  refundOrder: vi.fn(),
  canRefund: vi.fn(),
}));

vi.mock("@/lib/admin/org-access", () => ({ requireOrderManageAccess: m.access }));
vi.mock("@/lib/auth/rbac", () => ({ canRefund: m.canRefund }));
vi.mock("@/lib/db", () => ({
  prisma: { organization: { findUnique: m.orgFind }, ticket: { findMany: m.ticketFind } },
}));
vi.mock("@/services/refund-service", () => ({ RefundService: { refundOrder: m.refundOrder } }));

import { POST } from "@/app/api/admin/orders/[orderNumber]/refund/route";

const ctx = { params: Promise.resolve({ orderNumber: "TKT-1" }) };
const req = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": `1.1.1.${Math.random()}` } });

describe("POST /api/admin/orders/[orderNumber]/refund", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.access.mockResolvedValue({ user: { id: "u1" }, order: { id: "o1", organizationId: "org1" } });
    m.orgFind.mockResolvedValue({ allowRefunds: true });
    m.canRefund.mockReturnValue(true);
    m.refundOrder.mockResolvedValue({ amount: 34000, currency: "NOK" });
  });

  it("refunds 2 of 3 unused tickets (newest first)", async () => {
    m.ticketFind.mockResolvedValue([{ id: "t3" }, { id: "t2" }, { id: "t1" }]);
    const res = await POST(req({ quantity: 2, reason: "kjøpte for mange" }), ctx);
    expect(res.status).toBe(200);
    expect(m.refundOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o1", ticketIds: ["t3", "t2"], reason: "kjøpte for mange" })
    );
    expect(await res.json()).toMatchObject({ refunded: 2, amount: 34000 });
  });

  it("rejects more than the unused tickets", async () => {
    m.ticketFind.mockResolvedValue([{ id: "t1" }]);
    const res = await POST(req({ quantity: 2 }), ctx);
    expect(res.status).toBe(409);
    expect(m.refundOrder).not.toHaveBeenCalled();
  });

  it("requires refund permission", async () => {
    m.canRefund.mockReturnValue(false);
    const res = await POST(req({ quantity: 1 }), ctx);
    expect(res.status).toBe(403);
  });
});
