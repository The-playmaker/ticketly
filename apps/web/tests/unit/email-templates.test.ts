import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn(async () => ({ id: "msg_test" }));

vi.mock("@/lib/email/provider", () => ({
  getEmailProvider: () => ({ send: sendMock }),
}));

vi.mock("@/services/notification-service", () => ({
  NotificationService: {
    logAndSend: vi.fn(async (input: { subject: string; html: string; text: string }) => ({
      ok: true,
      ...input,
    })),
  },
}));

import {
  sendOrderConfirmationEmail,
  sendRefundEmail,
  sendTicketDeliveryEmail,
} from "@/lib/email/templates";
import { emailLegalLinks, wrapEmailHtml } from "@/lib/email/layout";
import { NotificationService } from "@/services/notification-service";

describe("email layout", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://tickets.example.com";
    sendMock.mockClear();
    vi.mocked(NotificationService.logAndSend).mockClear();
  });

  it("builds branded HTML with CTA and legal links, without trackers", () => {
    const html = wrapEmailHtml({
      preheader: "Pre",
      title: "Ordrebekreftelse",
      bodyHtml: "<p>Body</p>",
      cta: { href: "https://tickets.example.com/orders/TKT-1?t=secret", label: "Vis billetter" },
      supportEmail: "hjelp@example.com",
      sellerName: "Demo AS",
    });

    expect(html).toContain("Ticketly");
    expect(html).toContain("Ordrebekreftelse");
    expect(html).toContain("Vis billetter");
    expect(html).toContain("#ff5a1f");
    expect(html).toContain("#131316");
    expect(html).toContain("https://tickets.example.com/terms");
    expect(html).toContain("https://tickets.example.com/privacy");
    expect(html).toContain("https://tickets.example.com/refund-policy");
    expect(html).toContain("hjelp@example.com");
    expect(html.toLowerCase()).not.toContain("utm_");
    expect(html.toLowerCase()).not.toContain("pixel");
    expect(html.toLowerCase()).not.toContain("open tracking");
    expect(html).not.toContain("webhook");
    expect(html).not.toContain("idempotency");
  });

  it("exposes public legal URLs only", () => {
    const links = emailLegalLinks();
    expect(links.terms).toBe("https://tickets.example.com/terms");
    expect(links.privacy).toBe("https://tickets.example.com/privacy");
    expect(links.refund).toBe("https://tickets.example.com/refund-policy");
  });
});

describe("transactional email subjects and copy", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://tickets.example.com";
    sendMock.mockClear();
    vi.mocked(NotificationService.logAndSend).mockClear();
  });

  it("sends distinct order confirmation content with plain text", async () => {
    const result = await sendOrderConfirmationEmail({
      to: "buyer@example.com",
      customerName: "Ada Buyer",
      orderNumber: "TKT-100",
      eventName: "Friday Night",
      eventWhen: "17. okt. 2026 kl. 22:00",
      venue: "Villa",
      ageLimit: 20,
      quantity: 2,
      total: 50000,
      currency: "NOK",
      sellerName: "Titan Events AS",
      ticketsUrl: "https://tickets.example.com/orders/TKT-100?t=access-token",
      supportEmail: "support@titan.example",
      orderId: "ord_1",
      eventId: "evt_1",
    });

    expect(result.ok).toBe(true);
    expect(NotificationService.logAndSend).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(NotificationService.logAndSend).mock.calls[0]![0];
    expect(payload.subject).toBe("Ordrebekreftelse – Friday Night");
    expect(payload.text).toContain("Ordrenummer: TKT-100");
    expect(payload.text).toContain("Vis billetter:");
    expect(payload.text).toContain("Kjøpsvilkår:");
    expect(payload.html).toContain("Vis billetter");
    expect(payload.html).toContain("Friday Night");
    expect(payload.html).toContain("20+");
    expect(payload.html).not.toContain("webhook");
  });

  it("sends distinct ticket delivery subject focused on entry", async () => {
    await sendTicketDeliveryEmail({
      to: "buyer@example.com",
      customerName: "Ada Buyer",
      eventName: "Friday Night",
      eventWhen: "17. okt. 2026 kl. 22:00",
      venue: "Villa",
      ageLimit: 20,
      orderNumber: "TKT-100",
      ticketsUrl: "https://tickets.example.com/orders/TKT-100?t=access-token",
      orderId: "ord_1",
    });

    const payload = vi.mocked(NotificationService.logAndSend).mock.calls[0]![0];
    expect(payload.subject).toBe("Billettene dine – Friday Night");
    expect(payload.subject).not.toContain("Ordrebekreftelse");
    expect(payload.text).toContain("Billettene dine til Friday Night er klare");
    expect(payload.html).toContain("én QR per billett");
  });

  it("sends distinct refund subject and plain-text alternative", async () => {
    await sendRefundEmail({
      to: "buyer@example.com",
      customerName: "Ada Buyer",
      orderNumber: "TKT-100",
      amount: 50000,
      currency: "NOK",
      eventName: "Friday Night",
      orderId: "ord_1",
    });

    const payload = vi.mocked(NotificationService.logAndSend).mock.calls[0]![0];
    expect(payload.subject).toBe("Refusjon startet – ordre TKT-100");
    expect(payload.text).toContain("Vi har startet refusjon");
    expect(payload.html).toContain("Refusjon startet");
    expect(payload.html).not.toContain("Ordrebekreftelse");
  });
});
