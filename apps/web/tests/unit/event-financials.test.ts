import { describe, expect, it } from "vitest";
import { PaymentStatus, TicketStatus } from "@prisma/client";
import {
  aggregateFinancialTotals,
  computeNetRevenue,
} from "@/lib/admin/event-financials";

const paidAt = new Date("2026-10-01T12:00:00Z");

describe("event financial reporting", () => {
  it("paid 170 NOK, no refund → gross=net=17000, refund=0", () => {
    const totals = aggregateFinancialTotals({
      orders: [
        {
          total: 17000,
          paidAt,
          paymentStatus: PaymentStatus.PAID,
        },
      ],
      refunds: [],
      tickets: [{ status: TicketStatus.VALID }],
    });
    expect(totals.grossSales).toBe(17000);
    expect(totals.successfulRefundAmount).toBe(0);
    expect(totals.netRevenue).toBe(17000);
    expect(totals.activeSoldTicketCount).toBe(1);
    expect(totals.refundedTicketCount).toBe(0);
  });

  it("full refund 170 NOK → gross stays 17000, refund=17000, net=0", () => {
    const totals = aggregateFinancialTotals({
      orders: [
        {
          total: 17000,
          paidAt,
          paymentStatus: PaymentStatus.REFUNDED,
        },
      ],
      refunds: [{ amount: 17000, status: "SUCCEEDED" }],
      tickets: [{ status: TicketStatus.REFUNDED }],
    });
    expect(totals.grossSales).toBe(17000);
    expect(totals.successfulRefundAmount).toBe(17000);
    expect(totals.netRevenue).toBe(0);
    expect(totals.activeSoldTicketCount).toBe(0);
    expect(totals.refundedTicketCount).toBe(1);
  });

  it("partial refund reduces net by only the refunded amount", () => {
    // Order 34000 (2×170), refund one ticket 17000
    const totals = aggregateFinancialTotals({
      orders: [
        {
          total: 34000,
          paidAt,
          paymentStatus: PaymentStatus.PARTIALLY_REFUNDED,
        },
      ],
      refunds: [{ amount: 17000, status: "SUCCEEDED" }],
      tickets: [{ status: TicketStatus.VALID }, { status: TicketStatus.REFUNDED }],
    });
    expect(totals.grossSales).toBe(34000);
    expect(totals.successfulRefundAmount).toBe(17000);
    expect(totals.netRevenue).toBe(17000);
    expect(totals.activeSoldTicketCount).toBe(1);
    expect(totals.refundedTicketCount).toBe(1);
  });

  it("multiple tickets, one refunded — active vs refunded counts", () => {
    const totals = aggregateFinancialTotals({
      orders: [
        {
          total: 51000,
          paidAt,
          paymentStatus: PaymentStatus.PARTIALLY_REFUNDED,
        },
      ],
      refunds: [{ amount: 17000, status: "SUCCEEDED" }],
      tickets: [
        { status: TicketStatus.VALID },
        { status: TicketStatus.CHECKED_IN },
        { status: TicketStatus.REFUNDED },
      ],
    });
    expect(totals.grossSales).toBe(51000);
    expect(totals.netRevenue).toBe(34000);
    expect(totals.activeSoldTicketCount).toBe(2);
    expect(totals.refundedTicketCount).toBe(1);
  });

  it("duplicate refund rows with same SUCCEEDED amounts would inflate — only SUCCEEDED counted once per row", () => {
    // Modeling webhook retry that incorrectly inserted a second SUCCEEDED row:
    // dashboard must sum rows; unique providerRefundId prevents this in DB.
    // If two distinct SUCCEEDED rows exist, both sum — callers must ensure idempotency.
    const withDuplicate = aggregateFinancialTotals({
      orders: [
        {
          total: 17000,
          paidAt,
          paymentStatus: PaymentStatus.REFUNDED,
        },
      ],
      refunds: [
        { amount: 17000, status: "SUCCEEDED" },
        { amount: 17000, status: "SUCCEEDED" }, // bad duplicate
      ],
      tickets: [{ status: TicketStatus.REFUNDED }],
    });
    expect(withDuplicate.successfulRefundAmount).toBe(34000);

    // Correct: single SUCCEEDED + PENDING/FAILED retries ignored
    const idempotent = aggregateFinancialTotals({
      orders: [
        {
          total: 17000,
          paidAt,
          paymentStatus: PaymentStatus.REFUNDED,
        },
      ],
      refunds: [
        { amount: 17000, status: "SUCCEEDED" },
        { amount: 17000, status: "PENDING" },
        { amount: 17000, status: "FAILED" },
      ],
      tickets: [{ status: TicketStatus.REFUNDED }],
    });
    expect(idempotent.successfulRefundAmount).toBe(17000);
    expect(idempotent.netRevenue).toBe(0);
  });

  it("fully refunded order remains in gross; PENDING orders excluded", () => {
    const totals = aggregateFinancialTotals({
      orders: [
        { total: 17000, paidAt, paymentStatus: PaymentStatus.REFUNDED },
        { total: 9900, paidAt: null, paymentStatus: PaymentStatus.PENDING },
        { total: 5000, paidAt: null, paymentStatus: PaymentStatus.FAILED },
      ],
      refunds: [{ amount: 17000, status: "SUCCEEDED" }],
      tickets: [{ status: TicketStatus.REFUNDED }],
    });
    expect(totals.grossSales).toBe(17000);
    expect(totals.paidOrderCount).toBe(1);
    expect(computeNetRevenue(totals.grossSales, totals.successfulRefundAmount)).toBe(0);
  });
});
