import { afterEach, describe, expect, it } from "vitest";
import { PaymentProviderType } from "@prisma/client";
import { NexiApiError } from "@/lib/payments/nexi-client";
import {
  classifyCreateCheckoutFailure,
  resolveBackupProviderType,
  shouldFailoverToBackup,
} from "@/lib/payments/failover";
import { resolvePaymentProviderType } from "@/lib/payments/resolve-provider";

describe("payment failover policy", () => {
  const envKeys = [
    "PAYMENT_PROVIDER",
    "PAYMENT_BACKUP_PROVIDER",
    "PAYMENT_STRIPE_BACKUP",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function snap() {
    for (const k of envKeys) saved[k] = process.env[k];
  }

  it("defaults primary to Nexi / Nets Easy", () => {
    snap();
    delete process.env.PAYMENT_PROVIDER;
    expect(resolvePaymentProviderType()).toBe(PaymentProviderType.NEXI);
  });

  it("resolves Stripe backup when PAYMENT_BACKUP_PROVIDER=stripe", () => {
    snap();
    process.env.PAYMENT_PROVIDER = "nexi";
    process.env.PAYMENT_BACKUP_PROVIDER = "stripe";
    expect(resolveBackupProviderType(PaymentProviderType.NEXI)).toBe(
      PaymentProviderType.STRIPE
    );
  });

  it("resolves Stripe backup via PAYMENT_STRIPE_BACKUP=true", () => {
    snap();
    process.env.PAYMENT_PROVIDER = "nexi";
    delete process.env.PAYMENT_BACKUP_PROVIDER;
    process.env.PAYMENT_STRIPE_BACKUP = "true";
    expect(resolveBackupProviderType(PaymentProviderType.NEXI)).toBe(
      PaymentProviderType.STRIPE
    );
  });

  it("does not treat same provider as backup", () => {
    snap();
    process.env.PAYMENT_BACKUP_PROVIDER = "nexi";
    expect(resolveBackupProviderType(PaymentProviderType.NEXI)).toBeNull();
  });

  it("classifies config errors as definitive_unavailable", () => {
    expect(
      classifyCreateCheckoutFailure(
        new Error("NEXI_SECRET_API_KEY is missing or still a placeholder")
      )
    ).toBe("definitive_unavailable");
    expect(shouldFailoverToBackup(new Error("STRIPE_SECRET_KEY is not configured"))).toBe(
      true
    );
  });

  it("classifies 401/403 as definitive_unavailable", () => {
    expect(classifyCreateCheckoutFailure(new NexiApiError("Unauthorized", 401))).toBe(
      "definitive_unavailable"
    );
    expect(classifyCreateCheckoutFailure(new NexiApiError("Forbidden", 403))).toBe(
      "definitive_unavailable"
    );
  });

  it("does NOT failover on network / 5xx / unknown", () => {
    expect(classifyCreateCheckoutFailure(new NexiApiError("timeout", 0))).toBe(
      "unknown_or_pending"
    );
    expect(classifyCreateCheckoutFailure(new NexiApiError("boom", 503))).toBe(
      "unknown_or_pending"
    );
    expect(shouldFailoverToBackup(new Error("something weird"))).toBe(false);
  });

  it("does NOT failover on client validation errors", () => {
    expect(
      classifyCreateCheckoutFailure(new NexiApiError("bad amount", 400))
    ).toBe("client_error");
    expect(shouldFailoverToBackup(new NexiApiError("bad amount", 400))).toBe(false);
  });
});
