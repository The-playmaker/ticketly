import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmailProvider } from "@/lib/email/provider";

describe("Resend sender name and reply-to", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses EMAIL_FROM_NAME and EMAIL_REPLY_TO", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "noreply@titan-systems.no");
    vi.stubEnv("EMAIL_FROM_NAME", "XO Drammen");
    vi.stubEnv("EMAIL_REPLY_TO", "support@titan-systems.no");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "e1" }) });
    vi.stubGlobal("fetch", fetchMock);

    await new ResendEmailProvider().send({ to: { email: "a@b.no" }, subject: "s", html: "<p>h</p>" });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.from).toBe("XO Drammen <noreply@titan-systems.no>");
    expect(body.reply_to).toBe("support@titan-systems.no");
  });

  it("omits reply_to when not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_REPLY_TO", "");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "e1" }) });
    vi.stubGlobal("fetch", fetchMock);
    await new ResendEmailProvider().send({ to: { email: "a@b.no" }, subject: "s", html: "h" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).reply_to).toBeUndefined();
  });
});
