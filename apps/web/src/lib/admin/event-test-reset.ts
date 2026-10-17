/**
 * Shared constants + response shapes for SUPER_ADMIN event test-data reset.
 * Keep free of server-only imports so client components can reuse them.
 */

export const TEST_EVENT_RESET_CONFIRMATION = "RESET TEST EVENT";
/** Emergency override only — requires ALLOW_PRODUCTION_EVENT_RESET=true. */
export const EMERGENCY_EVENT_RESET_CONFIRMATION = "I UNDERSTAND THIS IS PRODUCTION";
/** @deprecated Use EMERGENCY_EVENT_RESET_CONFIRMATION */
export const PRODUCTION_EVENT_RESET_CONFIRMATION = EMERGENCY_EVENT_RESET_CONFIRMATION;
export const EVENT_TEST_DATA_RESET_ACTION = "EVENT_TEST_DATA_RESET";

/** Order payment statuses that mean money is still unsettled — reset is blocked. */
export const UNSETTLED_FINANCIAL_STATUSES = [
  "PAID",
  "PARTIALLY_REFUNDED",
  "REVIEW_REQUIRED",
  "AUTHORIZED",
] as const;

export type EventTestResetCounts = {
  orders: number;
  paidOrders: number;
  refundedOrders: number;
  unsettledOrders: number;
  payments: number;
  refunds: number;
  tickets: number;
  refundedTickets: number;
  checkedInTickets: number;
  reservations: number;
  checkIns: number;
  offlineCheckIns: number;
  webhookEvents: number;
  notificationLogs: number;
  analyticsEvents: number;
  orderSnapshots: number;
  walletPasses: number;
  waitlistEntries: number;
  reminderJobs: number;
  /** Orders that referenced a promo code (scoped usage count). */
  promoUsages: number;
  ticketTypes: Array<{
    id: string;
    name: string;
    quantitySold: number;
    quantityReserved: number;
    quantityReleased: number;
    quantityTotal: number;
    price: number;
  }>;
};

export type SafetyGateResult = {
  /** True when reset must not proceed without emergency override. */
  blocked: boolean;
  reasons: string[];
  unsettledByStatus: Partial<Record<string, number>>;
  /** Env ALLOW_PRODUCTION_EVENT_RESET is set — emergency path available. */
  overrideAvailable: boolean;
  requiresEmergencyConfirmation: boolean;
};

/** @deprecated Alias of SafetyGateResult for older callers */
export type ProductionGateResult = SafetyGateResult;

export type EventTestResetResult = {
  dryRun: boolean;
  eventId: string;
  eventName: string;
  eventStatus: string;
  organizationId: string;
  organizationName: string;
  counts: EventTestResetCounts;
  safetyGate: SafetyGateResult;
  /** @deprecated Use safetyGate */
  productionGate: SafetyGateResult;
  deleted?: EventTestResetCounts;
  preserved: {
    event: true;
    quantityTotal: true;
    quantityReleased: true;
    price: true;
    eventConfig: true;
    stripeExternal: true;
  };
};
