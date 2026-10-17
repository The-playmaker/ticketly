import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const retrieveMock = vi.fn();

vi.mock("stripe", () => {
  class StripeMock {
    checkout = {
      sessions: {
        create: createMock,
        retrieve: retrieveMock,
      },
    };
    webhooks = { constructEvent: vi.fn() };
    refunds = { create: vi.fn() };
  }
  return { default: StripeMock };
});

describe("StripePaymentProvider Checkout Form (ui_mode=form)", () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    retrieveMock.mockReset();
    process.env.STRIPE_SECRET_KEY = "sk_test_unit_stripe_secret_key_xxxxx";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_stripe_webhook_xxxxx";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_unit_publishable_xxxxx";
  });

  it("creates a form-mode session with fixed_by_ui params and returns client_secret", async () => {
    createMock.mockResolvedValue({
      id: "cs_test_123",
      client_secret: "cs_test_123_secret_abc",
      payment_intent: null,
      url: null,
    });

    const { StripePaymentProvider } = await import("@/lib/payments/stripe-provider");
    const provider = new StripePaymentProvider();
    const result = await provider.createCheckout({
      orderId: "ord_1",
      orderNumber: "TKT-1",
      amount: 24900,
      currency: "NOK",
      customerEmail: "buyer@example.com",
      customerName: "Buyer Test",
      description: "Event – TKT-1",
      successUrl: "http://localhost:3456/orders/TKT-1?t=tok&checkout=success",
      cancelUrl: "http://localhost:3456/checkout?cancelled=1",
      metadata: { eventId: "evt_1" },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const [params, opts] = createMock.mock.calls[0]!;
    expect(params.mode).toBe("payment");
    expect(params.ui_mode).toBe("form");
    expect(params.billing_address_collection).toBe("auto");
    expect(params.phone_number_collection).toEqual({ enabled: false });
    expect(params.automatic_tax).toEqual({ enabled: false });
    expect(params.submit_type).toBe("auto");
    expect(params.name_collection).toEqual({ individual: { enabled: true } });
    expect(params.integration_identifier).toBe("custom_embedded_web_0001");
    expect(params.return_url).toContain("/orders/TKT-1");
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
    expect(params.payment_method_collection).toBeUndefined();
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(24900);
    expect(params.metadata?.orderId).toBe("ord_1");
    expect(opts).toEqual({ idempotencyKey: "checkout_ord_1" });

    expect(result.integrationType).toBe("EmbeddedCheckout");
    expect(result.clientSecret).toBe("cs_test_123_secret_abc");
    expect(result.checkoutKey).toBe("pk_test_unit_publishable_xxxxx");
    expect(result.checkoutScriptUrl).toBe("https://js.stripe.com/dahlia/stripe.js");
    expect(result.sessionId).toBe("cs_test_123");
    expect(result.checkoutUrl).toBeUndefined();
  });
});
