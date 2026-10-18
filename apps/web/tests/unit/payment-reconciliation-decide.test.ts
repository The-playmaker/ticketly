import { describe, expect, it } from "vitest";
import { PaymentStatus } from "@prisma/client";
import { PaymentReconciliationService } from "@/services/payment-reconciliation-service";
import type { StripeOrderLookup } from "@/lib/payments/stripe-lookup";
import { mapWithConcurrency, withStripeRetry } from "@/lib/payments/stripe-retry";

function baseOrder(status: PaymentStatus = PaymentStatus.PENDING) {
  return {
    id: "ord_1",
    orderNumber: "TKT-1",
    total: 24900,
    currency: "NOK",
    paymentStatus: status,
    paymentAnomaly: false,
  };
}

describe("PaymentReconciliationService.decide", () => {
  it("prefers succeeded PI over expired session", () => {
    const lookup: StripeOrderLookup = {
      session: {
        id: "cs_1",
        status: "expired",
        paymentStatus: "unpaid",
        amountTotal: 24900,
        currency: "nok",
        livemode: false,
        metadata: { orderId: "ord_1", orderNumber: "TKT-1" },
        paymentIntentId: "pi_1",
      },
      paymentIntent: {
        id: "pi_1",
        status: "succeeded",
        amount: 24900,
        currency: "nok",
        livemode: false,
        metadata: { orderId: "ord_1", orderNumber: "TKT-1" },
        lastPaymentErrorCode: null,
        outcomeType: null,
        riskLevel: null,
        amountRefunded: 0,
        chargeId: "ch_1",
      },
      refunds: [],
    };
    const d = PaymentReconciliationService.decide({
      order: baseOrder(),
      ticketlyRefunded: 0,
      lookup,
    });
    expect(d.action).toBe("mark_paid");
  });

  it("does not downgrade PAID on expired session", () => {
    const lookup: StripeOrderLookup = {
      session: {
        id: "cs_1",
        status: "expired",
        paymentStatus: "unpaid",
        amountTotal: 24900,
        currency: "nok",
        livemode: false,
        metadata: {},
        paymentIntentId: null,
      },
      paymentIntent: null,
      refunds: [],
    };
    const d = PaymentReconciliationService.decide({
      order: baseOrder(PaymentStatus.PAID),
      ticketlyRefunded: 0,
      lookup,
    });
    expect(d.action).toBe("skip_conflict");
  });

  it("flags amount mismatch as review", () => {
    const lookup: StripeOrderLookup = {
      session: null,
      paymentIntent: {
        id: "pi_1",
        status: "succeeded",
        amount: 100,
        currency: "nok",
        livemode: false,
        metadata: { orderId: "ord_1" },
        lastPaymentErrorCode: null,
        outcomeType: null,
        riskLevel: null,
        amountRefunded: 0,
        chargeId: null,
      },
      refunds: [],
    };
    const d = PaymentReconciliationService.decide({
      order: baseOrder(),
      ticketlyRefunded: 0,
      lookup,
    });
    expect(d.action).toBe("mark_review");
    expect(d.anomaly).toBe("AMOUNT_MISMATCH");
  });
});

describe("stripe-retry helpers", () => {
  it("retries then succeeds", async () => {
    let n = 0;
    const result = await withStripeRetry(
      async () => {
        n++;
        if (n < 3) {
          const err = new Error("rate") as Error & { statusCode: number };
          err.statusCode = 429;
          throw err;
        }
        return "ok";
      },
      { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 5 }
    );
    expect(result).toBe("ok");
    expect(n).toBe(3);
  });

  it("mapWithConcurrency respects bound", async () => {
    let live = 0;
    let maxLive = 0;
    const items = [1, 2, 3, 4, 5, 6];
    const out = await mapWithConcurrency(items, 2, async (n) => {
      live++;
      maxLive = Math.max(maxLive, live);
      await new Promise((r) => setTimeout(r, 10));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(maxLive).toBeLessThanOrEqual(2);
  });
});
