import { describe, expect, it } from "vitest";
import { DiscountType } from "@prisma/client";
import { AppError } from "@/lib/api-error";
import { PromoService } from "@/services/promo-service";

describe("PromoService promoter create rules", () => {
  it("rejects DISCOUNT with zero value via validation path", async () => {
    // Exercise the same guards used by create() without hitting DB when possible.
    // We call through a tiny local mirror of the guard by attempting create and
    // expecting INVALID_PROMO before / when DB is unavailable — assert message.
    try {
      await PromoService.create({
        organizationId: "org_missing",
        code: "ZERO",
        kind: "DISCOUNT",
        discountType: DiscountType.PERCENTAGE,
        discountValue: 0,
      });
      // If DB somehow accepts, still fail — zero discount DISCOUNT must throw first
      expect.fail("expected INVALID_PROMO");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("INVALID_PROMO");
    }
  });

  it("allows TRACKING with zero discount (validation passes; may fail on missing org FK)", async () => {
    try {
      await PromoService.create({
        organizationId: "org_missing",
        code: `TRK${Date.now()}`,
        kind: "TRACKING",
        label: "Test Promoter",
        discountType: DiscountType.FIXED,
        discountValue: 0,
      });
    } catch (e) {
      // Must NOT be INVALID_PROMO — zero is allowed for TRACKING
      if (e instanceof AppError) {
        expect(e.code).not.toBe("INVALID_PROMO");
      }
      // Prisma FK / DB-down is acceptable here
    }
  });
});
