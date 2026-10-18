import { describe, expect, it, vi } from "vitest";
import {
  isStripeCheckoutSessionId,
  isStripePaymentIntentId,
  lookupStripeForPayment,
  normalizeStripeLookupIds,
  type StripeLookupClient,
  type StripeSessionSnapshot,
} from "@/lib/payments/stripe-lookup";

describe("normalizeStripeLookupIds", () => {
  it("uses providerSessionId when it is cs_", () => {
    expect(
      normalizeStripeLookupIds({
        providerSessionId: "cs_live_abc",
        providerPaymentId: "pi_live_xyz",
      })
    ).toEqual({ sessionId: "cs_live_abc", paymentIntentId: "pi_live_xyz" });
  });

  it("recovers session id from providerPaymentId when both are cs_", () => {
    expect(
      normalizeStripeLookupIds({
        providerSessionId: "cs_live_same",
        providerPaymentId: "cs_live_same",
      })
    ).toEqual({ sessionId: "cs_live_same", paymentIntentId: null });
  });

  it("never treats cs_ as paymentIntentId", () => {
    expect(
      normalizeStripeLookupIds({
        providerSessionId: null,
        providerPaymentId: "cs_live_only",
      })
    ).toEqual({ sessionId: "cs_live_only", paymentIntentId: null });
  });

  it("keeps nulls when neither id is usable", () => {
    expect(
      normalizeStripeLookupIds({
        providerSessionId: "free_x",
        providerPaymentId: "mock_y",
      })
    ).toEqual({ sessionId: null, paymentIntentId: null });
  });
});

describe("id prefix helpers", () => {
  it("detects checkout session and payment intent prefixes", () => {
    expect(isStripeCheckoutSessionId("cs_live_1")).toBe(true);
    expect(isStripeCheckoutSessionId("pi_live_1")).toBe(false);
    expect(isStripePaymentIntentId("pi_live_1")).toBe(true);
    expect(isStripePaymentIntentId("cs_live_1")).toBe(false);
  });
});

describe("lookupStripeForPayment", () => {
  const openSession = (id: string, piId: string | null = null): StripeSessionSnapshot => ({
    id,
    status: "open",
    paymentStatus: "unpaid",
    amountTotal: 24900,
    currency: "nok",
    livemode: true,
    metadata: {},
    paymentIntentId: piId,
  });

  it("does not call paymentIntents.retrieve with a cs_ id", async () => {
    const retrievePaymentIntent = vi.fn(async () => null);
    const client: StripeLookupClient = {
      async retrieveSession(id) {
        return openSession(id, null);
      },
      retrievePaymentIntent,
      async listRefunds() {
        return [];
      },
    };

    const result = await lookupStripeForPayment(client, {
      sessionId: "cs_live_abandoned",
      paymentIntentId: "cs_live_abandoned",
    });

    expect(result.session?.id).toBe("cs_live_abandoned");
    expect(result.paymentIntent).toBeNull();
    expect(retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it("uses session.payment_intent when providerPaymentId is cs_", async () => {
    const retrievePaymentIntent = vi.fn(async (id: string) => ({
      id,
      status: "succeeded" as const,
      amount: 24900,
      currency: "nok",
      livemode: true,
      metadata: {},
      lastPaymentErrorCode: null,
      outcomeType: null,
      riskLevel: null,
      amountRefunded: 0,
      chargeId: "ch_1",
    }));
    const client: StripeLookupClient = {
      async retrieveSession(id) {
        return {
          ...openSession(id, "pi_from_session"),
          status: "complete",
          paymentStatus: "paid",
        };
      },
      retrievePaymentIntent,
      async listRefunds() {
        return [];
      },
    };

    const result = await lookupStripeForPayment(client, {
      sessionId: "cs_live_paid",
      paymentIntentId: "cs_live_paid",
    });

    expect(retrievePaymentIntent).toHaveBeenCalledTimes(1);
    expect(retrievePaymentIntent).toHaveBeenCalledWith("pi_from_session");
    expect(result.paymentIntent?.id).toBe("pi_from_session");
  });

  it("prefers explicit pi_ over session when both present", async () => {
    const retrievePaymentIntent = vi.fn(async (id: string) => ({
      id,
      status: "succeeded" as const,
      amount: 24900,
      currency: "nok",
      livemode: false,
      metadata: {},
      lastPaymentErrorCode: null,
      outcomeType: null,
      riskLevel: null,
      amountRefunded: 0,
      chargeId: null,
    }));
    const client: StripeLookupClient = {
      async retrieveSession(id) {
        return openSession(id, "pi_from_session");
      },
      retrievePaymentIntent,
      async listRefunds() {
        return [];
      },
    };

    await lookupStripeForPayment(client, {
      sessionId: "cs_1",
      paymentIntentId: "pi_explicit",
    });

    expect(retrievePaymentIntent).toHaveBeenCalledWith("pi_explicit");
  });
});
