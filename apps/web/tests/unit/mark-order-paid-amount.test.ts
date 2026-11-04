import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentProviderType, PaymentStatus } from "@prisma/client";
import { AppError } from "@/lib/api-error";

const orderUpdate = vi.fn();
const findUnique = vi.fn();
const writeAuditLog = vi.fn();
const issueTickets = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    order: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => orderUpdate(...args),
    },
    payment: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));

vi.mock("@/services/ticket-service", () => ({
  TicketService: {
    issueTicketsForPaidOrder: (...args: unknown[]) => issueTickets(...args),
  },
}));

vi.mock("@ticketly/ticketing", () => ({
  createOrderSnapshot: vi.fn(),
}));

import { markOrderPaidImpl } from "@/services/payment-service-paid";

describe("markOrderPaid amount+currency required", () => {
  const order = {
    id: "ord-1",
    organizationId: "org-1",
    eventId: "evt-1",
    total: 51900,
    currency: "NOK",
    paymentStatus: PaymentStatus.PENDING,
    paymentAnomaly: false,
  };

  beforeEach(() => {
    findUnique.mockReset();
    orderUpdate.mockReset();
    writeAuditLog.mockReset();
    issueTickets.mockReset();
    findUnique.mockResolvedValue(order);
    orderUpdate.mockResolvedValue({ ...order, paymentStatus: PaymentStatus.REVIEW_REQUIRED });
  });

  it("PAID without amount → REVIEW_REQUIRED AMOUNT_MISSING and no tickets", async () => {
    await expect(
      markOrderPaidImpl({
        orderId: order.id,
        provider: PaymentProviderType.STRIPE,
        providerSessionId: "cs_x",
        currency: "NOK",
      })
    ).rejects.toMatchObject({ code: "AMOUNT_MISSING" } satisfies Partial<AppError>);

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentStatus: PaymentStatus.REVIEW_REQUIRED,
          paymentAnomaly: true,
          paymentAnomalyReason: "AMOUNT_MISSING",
        }),
      })
    );
    expect(issueTickets).not.toHaveBeenCalled();
  });

  it("PAID without currency → REVIEW_REQUIRED AMOUNT_MISSING and no tickets", async () => {
    await expect(
      markOrderPaidImpl({
        orderId: order.id,
        provider: PaymentProviderType.STRIPE,
        amount: 51900,
      })
    ).rejects.toMatchObject({ code: "AMOUNT_MISSING" });

    expect(issueTickets).not.toHaveBeenCalled();
  });
});
