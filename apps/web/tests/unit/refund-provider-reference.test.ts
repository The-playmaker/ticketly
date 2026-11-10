import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findOrder: vi.fn(),
  refundCreate: vi.fn(),
  paymentUpdate: vi.fn(),
  paymentFindFirst: vi.fn(),
  providerRefund: vi.fn(),
  resolvePi: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    order: { findUniqueOrThrow: m.findOrder },
    refund: {
      create: m.refundCreate,
      update: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    payment: { update: m.paymentUpdate, findFirst: m.paymentFindFirst },
    // Stop after the provider step: we only assert what happens before it.
    $transaction: vi.fn().mockRejectedValue(new Error("STOP_AFTER_PROVIDER")),
  },
}));
vi.mock("@/lib/payments", () => ({
  getPaymentProvider: () => ({ refund: m.providerRefund }),
}));
vi.mock("@/lib/payments/stripe-provider", () => ({
  resolveStripePaymentIntentId: m.resolvePi,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/email/templates", () => ({ sendRefundEmail: vi.fn() }));

import { RefundService } from "@/services/refund-service";

function order(payment: Record<string, unknown> | null) {
  return {
    id: "o1",
    organizationId: "org1",
    total: 17000,
    currency: "NOK",
    paymentStatus: "PAID",
    tickets: [{ id: "t1", status: "VALID", ticketTypeId: "tt1" }],
    payments: payment ? [payment] : [],
    refunds: [],
    organization: {},
    event: {},
  };
}

describe("refund never succeeds on paper only", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.refundCreate.mockResolvedValue({ id: "r1" });
    m.providerRefund.mockResolvedValue({ providerRefundId: "re_1", status: "SUCCEEDED", amount: 17000 });
  });

  it("resolves the PaymentIntent from the Checkout Session and refunds at Stripe", async () => {
    m.findOrder.mockResolvedValue(
      order({ id: "p1", provider: "STRIPE", providerPaymentId: null, providerSessionId: "cs_live_1" })
    );
    m.resolvePi.mockResolvedValue("pi_123");
    await expect(RefundService.refundOrder({ orderId: "o1" })).rejects.toThrow("STOP_AFTER_PROVIDER");
    expect(m.resolvePi).toHaveBeenCalledWith("cs_live_1");
    expect(m.paymentUpdate).toHaveBeenCalledWith({ where: { id: "p1" }, data: { providerPaymentId: "pi_123" } });
    expect(m.providerRefund).toHaveBeenCalledWith(expect.objectContaining({ providerPaymentId: "pi_123" }));
  });

  it("refuses when no provider reference can be found", async () => {
    m.findOrder.mockResolvedValue(
      order({ id: "p1", provider: "STRIPE", providerPaymentId: null, providerSessionId: null })
    );
    await expect(RefundService.refundOrder({ orderId: "o1" })).rejects.toMatchObject({
      code: "REFUND_NO_PAYMENT_REFERENCE",
    });
    expect(m.refundCreate).not.toHaveBeenCalled();
    expect(m.providerRefund).not.toHaveBeenCalled();
  });

  it("falls back to a non-PAID provider payment row on a paid order", async () => {
    m.findOrder.mockResolvedValue(order(null));
    m.paymentFindFirst.mockResolvedValue({
      id: "p2",
      provider: "STRIPE",
      providerPaymentId: "pi_999",
      providerSessionId: "cs_2",
    });
    await expect(RefundService.refundOrder({ orderId: "o1" })).rejects.toThrow("STOP_AFTER_PROVIDER");
    expect(m.providerRefund).toHaveBeenCalledWith(expect.objectContaining({ providerPaymentId: "pi_999" }));
  });
});
