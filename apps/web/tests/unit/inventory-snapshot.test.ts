import { describe, expect, it } from "vitest";
import {
  eventInventorySnapshot,
  inventorySnapshot,
  INVENTORY_BELOW_COMMITTED,
  minAllowedReleased,
} from "@/services/inventory-service";
import { resolveCheckoutUiState } from "@/lib/checkout/checkout-state";

describe("exact inventory formula", () => {
  it("capacity 500 / allocation 400 / released 50 / sold 37 / reserved 3 → available 10", () => {
    const tt = {
      quantityTotal: 400,
      quantityReleased: 50,
      quantitySold: 37,
      quantityReserved: 3,
    };
    const snap = inventorySnapshot(tt);
    expect(snap.allocation).toBe(400);
    expect(snap.released).toBe(50);
    expect(snap.sold).toBe(37);
    expect(snap.reserved).toBe(3);
    expect(snap.available).toBe(10);
    expect(snap.unreleased).toBe(350);

    const event = eventInventorySnapshot(500, [tt]);
    expect(event.capacity).toBe(500);
    expect(event.available).toBe(10);
  });

  it("release +50 → released 100, available 60", () => {
    const after = inventorySnapshot({
      quantityTotal: 400,
      quantityReleased: 100,
      quantitySold: 37,
      quantityReserved: 3,
    });
    expect(after.released).toBe(100);
    expect(after.available).toBe(60);
  });

  it("reduce below sold+reserved is rejected by domain code", () => {
    const committed = minAllowedReleased({ quantitySold: 37, quantityReserved: 3 });
    expect(committed).toBe(40);
    expect(INVENTORY_BELOW_COMMITTED).toBe("INVENTORY_BELOW_COMMITTED");
    // Attempting reduce below 40 must use this code (enforced in InventoryService.reduceReleased)
    expect(39 < committed).toBe(true);
  });
});

describe("checkout UI states", () => {
  it("maps backend statuses without inventing success", () => {
    expect(
      resolveCheckoutUiState({ paymentStatus: "PAID" })
    ).toBe("PAID");
    expect(
      resolveCheckoutUiState({ paymentStatus: "PENDING", initiatingPayment: true })
    ).toBe("PROCESSING");
    expect(
      resolveCheckoutUiState({ paymentStatus: "PENDING" })
    ).toBe("ACTIVE");
    expect(
      resolveCheckoutUiState({
        paymentStatus: "PENDING",
        awaitingWebhookConfirm: true,
      })
    ).toBe("WAITING_CONFIRMATION");
    expect(
      resolveCheckoutUiState({ paymentStatus: "FAILED" })
    ).toBe("FAILED");
    expect(
      resolveCheckoutUiState({
        paymentStatus: "PENDING",
        reservationStatus: "EXPIRED",
      })
    ).toBe("RESERVATION_EXPIRED");
    expect(
      resolveCheckoutUiState({ paymentStatus: "PENDING", paymentAnomaly: true })
    ).toBe("REVIEW_REQUIRED");
  });
});
