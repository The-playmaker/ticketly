import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentStatus } from "@prisma/client";

describe("NexiCheckoutProvider", () => {
  beforeEach(() => {
    process.env.NEXI_ENVIRONMENT = "test";
    process.env.NEXI_SECRET_API_KEY = "nexi_unit_secret_abcdefghijklmnop";
    process.env.NEXI_CHECKOUT_KEY = "nexi_unit_checkout_abcdefghijklmnop";
    process.env.NEXI_WEBHOOK_SECRET = "webhooksecret123456";
    process.env.APP_URL = "https://ticketly.test";
    process.env.PAYMENT_PROVIDER = "nexi";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadProvider() {
    const mod = await import("@/lib/payments/nexi-provider");
    return new mod.NexiCheckoutProvider();
  }

  it("creates payment successfully with charge:true and EmbeddedCheckout", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          paymentId: "pay_abc123",
          expiresAt: "2030-01-01T00:00:00Z",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await loadProvider();
    const result = await provider.createCheckout({
      orderId: "order1",
      orderNumber: "TKT-1",
      amount: 43800,
      currency: "NOK",
      customerEmail: "a@b.no",
      customerName: "Ada Lovelace",
      customerFirstName: "Ada",
      customerLastName: "Lovelace",
      customerPhone: "+4712345678",
      description: "Konsert",
      successUrl: "https://ticketly.test/orders/TKT-1?checkout=success",
      cancelUrl: "https://ticketly.test/checkout?cancelled=1",
      checkoutPageUrl: "https://ticketly.test/checkout/payment",
      items: [
        {
          reference: "tt1",
          name: "Ordinær",
          quantity: 1,
          unit: "pcs",
          unitPrice: 43800,
          taxRate: 0,
          taxAmount: 0,
          grossTotalAmount: 43800,
          netTotalAmount: 43800,
        },
      ],
    });

    expect(result.paymentId).toBe("pay_abc123");
    expect(result.checkoutKey).toBe("nexi_unit_checkout_abcdefghijklmnop");
    expect(result.integrationType).toBe("EmbeddedCheckout");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.checkout.charge).toBe(true);
    expect(body.checkout.integrationType).toBe("EmbeddedCheckout");
    expect(body.order.amount).toBe(43800);
    expect(body.order.currency).toBe("NOK");
    expect(body.notifications.webHooks.length).toBeGreaterThan(0);
  });

  it("fails create payment on provider 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: "internal", code: "500" }),
      })
    );
    const provider = await loadProvider();
    await expect(
      provider.createCheckout({
        orderId: "o",
        orderNumber: "TKT-X",
        amount: 1000,
        currency: "NOK",
        customerEmail: "a@b.no",
        customerName: "A B",
        description: "t",
        successUrl: "https://ticketly.test/ok",
        cancelUrl: "https://ticketly.test/cancel",
      })
    ).rejects.toThrow(/internal|Nexi|500/i);
  });

  it("fails create payment on network timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("timeout"))
    );
    const provider = await loadProvider();
    await expect(
      provider.createCheckout({
        orderId: "o",
        orderNumber: "TKT-X",
        amount: 1000,
        currency: "NOK",
        customerEmail: "a@b.no",
        customerName: "A B",
        description: "t",
        successUrl: "https://ticketly.test/ok",
        cancelUrl: "https://ticketly.test/cancel",
      })
    ).rejects.toThrow(/network|timeout/i);
  });

  it("parses checkout completed webhook", async () => {
    const provider = await loadProvider();
    const parsed = await provider.parseWebhook(
      JSON.stringify({
        id: "evt_1",
        event: "payment.checkout.completed",
        data: {
          paymentId: "pay_1",
          myReference: "ordercuid123",
          order: { amount: { amount: "24900", currency: "NOK" }, reference: "TKT-1" },
        },
      }),
      "webhooksecret123456"
    );
    expect(parsed.handled).toBe(true);
    expect(parsed.paymentStatus).toBe(PaymentStatus.PAID);
    expect(parsed.amount).toBe(24900);
    expect(parsed.currency).toBe("NOK");
    expect(parsed.providerPaymentId).toBe("pay_1");
  });

  it("rejects webhook with wrong authorization", async () => {
    const provider = await loadProvider();
    await expect(
      provider.parseWebhook(
        JSON.stringify({ id: "e", event: "payment.checkout.completed", data: {} }),
        "wrong"
      )
    ).rejects.toThrow(/Authorization|Invalid/i);
  });

  it("maps Vipps-type payment metadata", async () => {
    const provider = await loadProvider();
    const parsed = await provider.parseWebhook(
      JSON.stringify({
        id: "evt_vipps",
        event: "payment.charge.created.v2",
        data: {
          paymentId: "pay_v",
          chargeId: "chg_1",
          paymentMethod: "Vipps",
          amount: { amount: "10000", currency: "NOK" },
        },
      }),
      "webhooksecret123456"
    );
    expect(parsed.paymentMethod).toBe("VIPPS");
    expect(parsed.paymentType).toBe("WALLET");
    expect(parsed.providerChargeId).toBe("chg_1");
  });

  it("maps card payment metadata", async () => {
    const provider = await loadProvider();
    const parsed = await provider.parseWebhook(
      JSON.stringify({
        id: "evt_card",
        event: "payment.charge.created.v2",
        data: {
          paymentId: "pay_c",
          chargeId: "chg_2",
          paymentMethod: "Visa",
          cardDetails: { truncatedPan: "****1111" },
          amount: { amount: "5000", currency: "NOK" },
        },
      }),
      "webhooksecret123456"
    );
    expect(parsed.paymentMethod).toBe("VISA");
    expect(parsed.paymentType).toBe("CARD");
  });

  it("refunds via charge id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ refundId: "ref_1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = await loadProvider();
    const result = await provider.refund({
      providerPaymentId: "pay_1",
      providerChargeId: "chg_1",
      amount: 1000,
      currency: "NOK",
      idempotencyKey: "refund_test_1",
    });
    expect(result.providerRefundId).toBe("ref_1");
    expect(result.status).toBe("PENDING");
    expect(fetchMock.mock.calls[0]![0]).toContain("/v1/charges/chg_1/refunds");
  });

  it("cancels authorized payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: async () => "",
      })
    );
    const provider = await loadProvider();
    const result = await provider.cancel!({ providerPaymentId: "pay_cancel" });
    expect(result.cancelled).toBe(true);
  });
});

describe("nexi status helpers", () => {
  it("maps event names to internal statuses", async () => {
    const { mapNexiEventToPaymentStatus, normalizeNexiPaymentMethod } = await import(
      "@/lib/payments/nexi-status"
    );
    expect(mapNexiEventToPaymentStatus("payment.checkout.completed")).toBe(PaymentStatus.PAID);
    expect(mapNexiEventToPaymentStatus("payment.reservation.created.v2")).toBe(
      PaymentStatus.AUTHORIZED
    );
    expect(mapNexiEventToPaymentStatus("payment.cancel.created")).toBe(PaymentStatus.CANCELLED);
    expect(normalizeNexiPaymentMethod("ApplePay")).toEqual({
      paymentMethod: "APPLEPAY",
      paymentType: "WALLET",
    });
  });
});

describe("resolvePaymentProviderType", () => {
  it("defaults to NEXI", async () => {
    process.env.PAYMENT_PROVIDER = "nexi";
    const { resolvePaymentProviderType } = await import("@/lib/payments");
    expect(resolvePaymentProviderType()).toBe("NEXI");
  });

  it("forbids mock in production", async () => {
    process.env.PAYMENT_PROVIDER = "mock";
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { resolvePaymentProviderType } = await import("@/lib/payments");
    expect(() => resolvePaymentProviderType()).toThrow(/mock|forbidden/i);
    vi.unstubAllEnvs();
  });
});
