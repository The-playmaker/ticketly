import { describe, expect, it } from "vitest";
import { PaymentStatus } from "@prisma/client";
import { NexiPaymentReconciliationService } from "@/services/nexi-payment-reconciliation-service";
import type { NexiOrderLookup } from "@/lib/payments/nexi-lookup";

function baseLookup(over: Partial<NexiOrderLookup> = {}): NexiOrderLookup {
  return {
    paymentId: "pay_test",
    amount: 24900,
    currency: "NOK",
    orderReference: "TKT-1",
    myReference: "order1",
    chargedAmount: 0,
    reservedAmount: 0,
    refundedAmount: 0,
    cancelledAmount: 0,
    chargeId: null,
    paymentMethod: null,
    paymentType: null,
    checkoutExpiresAt: null,
    terminatedAt: null,
    refunds: [],
    rawSummary: {},
    ...over,
  };
}

const order = {
  id: "order1",
  orderNumber: "TKT-1",
  total: 24900,
  currency: "NOK",
  paymentStatus: PaymentStatus.PENDING,
  paymentAnomaly: false,
};

describe("NexiPaymentReconciliationService.decide", () => {
  it("marks paid when Nexi charged and Ticketly pending", () => {
    const d = NexiPaymentReconciliationService.decide({
      order,
      ticketlyRefunded: 0,
      lookup: baseLookup({ chargedAmount: 24900, chargeId: "chg_1" }),
    });
    expect(d.action).toBe("mark_paid");
    expect(d.anomaly).toBe("NEXI_PAID_TICKETLY_PENDING");
  });

  it("never downgrades PAID on terminated/failed Nexi payment", () => {
    const d = NexiPaymentReconciliationService.decide({
      order: { ...order, paymentStatus: PaymentStatus.PAID },
      ticketlyRefunded: 0,
      lookup: baseLookup({
        chargedAmount: 0,
        terminatedAt: new Date().toISOString(),
      }),
    });
    expect(d.action).toBe("skip_conflict");
    expect(d.detail).toBe("will_not_downgrade_paid");
  });

  it("marks failed when terminated without charge and Ticketly pending", () => {
    const d = NexiPaymentReconciliationService.decide({
      order,
      ticketlyRefunded: 0,
      lookup: baseLookup({
        chargedAmount: 0,
        terminatedAt: new Date().toISOString(),
      }),
    });
    expect(d.action).toBe("mark_cancelled");
  });

  it("flags amount mismatch for unpaid Ticketly as review", () => {
    const d = NexiPaymentReconciliationService.decide({
      order,
      ticketlyRefunded: 0,
      lookup: baseLookup({
        chargedAmount: 100,
        amount: 100,
        chargeId: "chg",
      }),
    });
    expect(d.action).toBe("mark_review");
    expect(d.anomaly).toBe("AMOUNT_MISMATCH");
  });
});
