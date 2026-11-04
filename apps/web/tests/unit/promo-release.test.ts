import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentStatus } from "@prisma/client";

const findUnique = vi.fn();
const updateMany = vi.fn();
const promoUpdate = vi.fn();
const executeRaw = vi.fn();
const writeAuditLog = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    order: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    promoCode: {
      update: (...a: unknown[]) => promoUpdate(...a),
    },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

import { PromoService } from "@/services/promo-service";

describe("PromoService.releasePromoForOrder", () => {
  beforeEach(() => {
    findUnique.mockReset();
    updateMany.mockReset();
    promoUpdate.mockReset();
    executeRaw.mockReset();
    writeAuditLog.mockReset();
  });

  it("decrements usedCount and sets promoReleasedAt on PENDING expire", async () => {
    findUnique.mockResolvedValue({
      id: "ord-1",
      promoCodeId: "promo-1",
      promoReleasedAt: null,
      paymentStatus: PaymentStatus.PENDING,
      organizationId: "org-1",
    });
    updateMany.mockResolvedValue({ count: 1 });
    promoUpdate.mockResolvedValue({});
    executeRaw.mockResolvedValue(0);

    const first = await PromoService.releasePromoForOrder("ord-1", undefined, "PENDING_EXPIRE");
    expect(first.released).toBe(true);
    expect(promoUpdate).toHaveBeenCalledWith({
      where: { id: "promo-1" },
      data: { usedCount: { decrement: 1 } },
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ promoReleasedAt: expect.any(Date) }),
      })
    );
  });

  it("double cleanup is a no-op when promoReleasedAt already set", async () => {
    findUnique.mockResolvedValue({
      id: "ord-1",
      promoCodeId: "promo-1",
      promoReleasedAt: new Date(),
      paymentStatus: PaymentStatus.CANCELLED,
      organizationId: "org-1",
    });

    const second = await PromoService.releasePromoForOrder("ord-1", undefined, "PENDING_EXPIRE");
    expect(second.released).toBe(false);
    expect(promoUpdate).not.toHaveBeenCalled();
  });

  it("does not release for PAID orders", async () => {
    findUnique.mockResolvedValue({
      id: "ord-paid",
      promoCodeId: "promo-1",
      promoReleasedAt: null,
      paymentStatus: PaymentStatus.PAID,
      organizationId: "org-1",
    });

    const r = await PromoService.releasePromoForOrder("ord-paid");
    expect(r.released).toBe(false);
    expect(promoUpdate).not.toHaveBeenCalled();
  });
});
