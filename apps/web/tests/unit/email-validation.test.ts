import { describe, expect, it } from "vitest";
import {
  EMAIL_MESSAGES,
  emailSchema,
  emailTypoHint,
  normalizeEmail,
  suggestEmailTypo,
} from "@ticketly/validation";
import { checkoutContactSchema } from "@/lib/validators";

describe("emailSchema", () => {
  it("rejects invalid formats", () => {
    for (const value of [
      "",
      "not-an-email",
      "a@",
      "@b.com",
      "a@b",
      "a@b.c",
      "foo@bar..com",
      ".foo@bar.com",
      "foo.@bar.com",
    ]) {
      const r = emailSchema.safeParse(value);
      expect(r.success, value).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.message).toBe(EMAIL_MESSAGES.invalid);
      }
    }
  });

  it("accepts valid addresses and normalizes trim + lowercase", () => {
    const r = emailSchema.safeParse("  Foo.Bar+tickets@Gmail.COM  ");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toBe("foo.bar+tickets@gmail.com");
    }
  });

  it("accepts uncommon but well-formed domains (no MX gate)", () => {
    const r = emailSchema.safeParse("buyer@obscure-festival-tickets.example");
    expect(r.success).toBe(true);
  });
});

describe("normalizeEmail / typo hints", () => {
  it("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Ada@Live.NO ")).toBe("ada@live.no");
  });

  it("suggests common domain typos without blocking", () => {
    expect(suggestEmailTypo("kunde@gmail.con")).toBe("kunde@gmail.com");
    expect(suggestEmailTypo("kunde@gmial.com")).toBe("kunde@gmail.com");
    expect(suggestEmailTypo("kunde@hotmal.com")).toBe("kunde@hotmail.com");
    expect(suggestEmailTypo("kunde@outlok.com")).toBe("kunde@outlook.com");
    expect(suggestEmailTypo("kunde@onlin.no")).toBe("kunde@online.no");
    expect(suggestEmailTypo("kunde@gmail.com")).toBeNull();
    expect(suggestEmailTypo("kunde@rare-domain.museum")).toBeNull();
  });

  it("emailTypoHint returns Norwegian soft warning copy", () => {
    const hint = emailTypoHint("meg@gmail.con");
    expect(hint).toEqual({
      original: "meg@gmail.con",
      suggested: "meg@gmail.com",
      message: "Mente du meg@gmail.com?",
    });
  });
});

describe("checkoutContactSchema email confirm", () => {
  const base = {
    firstName: "Ola",
    lastName: "Nordmann",
    email: "ola@gmail.com",
  };

  it("accepts matching confirm (case/space insensitive)", () => {
    const r = checkoutContactSchema.safeParse({
      ...base,
      email: "  Ola@Gmail.COM ",
      emailConfirm: "ola@gmail.com",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("ola@gmail.com");
    }
  });

  it("rejects mismatched confirm", () => {
    const r = checkoutContactSchema.safeParse({
      ...base,
      emailConfirm: "ola@hotmail.com",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "emailConfirm");
      expect(issue?.message).toBe(EMAIL_MESSAGES.mismatch);
    }
  });

  it("allows omit of emailConfirm for non-checkout clients", () => {
    const r = checkoutContactSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("rejects invalid email on server schema", () => {
    const r = checkoutContactSchema.safeParse({
      ...base,
      email: "not-valid",
    });
    expect(r.success).toBe(false);
  });
});
