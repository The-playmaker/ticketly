import { describe, expect, it } from "vitest";
import {
  GENERIC_ERROR_FALLBACK,
  PAYMENT_ERROR_FALLBACK,
  toPaymentUserFacingError,
  toUserFacingError,
} from "@/lib/user-facing-error";

describe("toUserFacingError", () => {
  it("returns string errors as-is", () => {
    expect(toUserFacingError("Ugyldig kampanjekode")).toBe("Ugyldig kampanjekode");
  });

  it("extracts message from API { error: { code, message } }", () => {
    expect(
      toUserFacingError({
        error: { code: "TICKET_SOLD_OUT", message: "Denne billettypen er dessverre utsolgt." },
      })
    ).toBe("Denne billettypen er dessverre utsolgt.");
  });

  it("extracts string from { error: string }", () => {
    expect(toUserFacingError({ error: "For mange forespørsler" })).toBe("For mange forespørsler");
  });

  it("never surfaces [object Object] from structured envelopes", () => {
    // Classic bug: new Error({ code, message }) → message === "[object Object]"
    const broken = new Error(
      String({ code: "VALIDATION_ERROR", message: "Ugyldig forespørsel" })
    );
    expect(broken.message).toBe("[object Object]");
    expect(toUserFacingError(broken)).toBe(GENERIC_ERROR_FALLBACK);
    expect(toUserFacingError(broken)).not.toMatch(/object Object/i);
  });

  it("reads nested Stripe-like / SDK shapes (message, detail)", () => {
    expect(toUserFacingError({ message: "Kortet ble avvist" })).toBe("Kortet ble avvist");
    expect(toUserFacingError({ detail: "3-D Secure feilet" })).toBe("3-D Secure feilet");
    expect(
      toUserFacingError({
        error: { type: "card_error", message: "Your card was declined." },
      })
    ).toBe("Your card was declined.");
  });

  it("extracts Zod flatten formErrors / fieldErrors", () => {
    expect(
      toUserFacingError({
        formErrors: ["Ugyldig e-post"],
        fieldErrors: {},
      })
    ).toBe("Ugyldig e-post");
    expect(
      toUserFacingError({
        formErrors: [],
        fieldErrors: { email: ["Ugyldig e-post"] },
      })
    ).toBe("Ugyldig e-post");
  });

  it("uses custom fallback when nothing usable is found", () => {
    expect(toUserFacingError({ code: "X" }, "Ugyldig kampanjekode")).toBe("Ugyldig kampanjekode");
    expect(toUserFacingError(null)).toBe(GENERIC_ERROR_FALLBACK);
    expect(toUserFacingError(undefined)).toBe(GENERIC_ERROR_FALLBACK);
    expect(toUserFacingError({})).toBe(GENERIC_ERROR_FALLBACK);
  });

  it("rejects literal [object Object] strings", () => {
    expect(toUserFacingError("[object Object]")).toBe(GENERIC_ERROR_FALLBACK);
    expect(toUserFacingError("object Object]")).toBe(GENERIC_ERROR_FALLBACK);
  });
});

describe("toPaymentUserFacingError", () => {
  it("prefers API message for checkout failures", () => {
    expect(
      toPaymentUserFacingError({
        error: { code: "RATE_LIMITED", message: "For mange forespørsler" },
      })
    ).toBe("For mange forespørsler");
  });

  it("falls back to Norwegian payment copy — never [object Object]", () => {
    const fromReserveBug = new Error(
      // simulates ticket-selector: throw new Error(data.error) when data.error is object
      ({ code: "VALIDATION_ERROR", message: "Ugyldig forespørsel" } as unknown as string)
    );
    expect(fromReserveBug.message).toMatch(/object Object/i);
    expect(toPaymentUserFacingError(fromReserveBug)).toBe(PAYMENT_ERROR_FALLBACK);
    expect(toPaymentUserFacingError({ error: { code: "X" } })).toBe(PAYMENT_ERROR_FALLBACK);
  });

  it("reads Error.message when it is a real string", () => {
    expect(toPaymentUserFacingError(new Error("Mangler betalingsøkt fra server"))).toBe(
      "Mangler betalingsøkt fra server"
    );
  });
});

describe("checkout UI regression: structured error must render as readable string", () => {
  it("coerces reserve/checkout API body the way UI components do before setError", () => {
    const apiBody = {
      error: { code: "TICKET_SOLD_OUT", message: "Denne billettypen er dessverre utsolgt." },
    };
    // Old bug: throw new Error(data.error) → setError(e.message) → "[object Object]"
    const legacy = new Error(apiBody.error as unknown as string);
    expect(legacy.message).toBe("[object Object]");

    const fixed = toPaymentUserFacingError(apiBody);
    expect(fixed).toBe("Denne billettypen er dessverre utsolgt.");
    expect(fixed).not.toContain("object Object");
  });
});
