/**
 * Shared constants + response shapes for SUPER_ADMIN test-event reset.
 * Keep free of server-only imports so client components can reuse them.
 */

export const TEST_EVENT_RESET_CONFIRMATION = "RESET TEST EVENT";
export const PRODUCTION_EVENT_RESET_CONFIRMATION = "I UNDERSTAND THIS IS PRODUCTION";
export const EVENT_TEST_DATA_RESET_ACTION = "EVENT_TEST_DATA_RESET";

export type EventTestResetCounts = {
  orders: number;
  payments: number;
  refunds: number;
  tickets: number;
  reservations: number;
  checkIns: number;
  offlineCheckIns: number;
  webhookEvents: number;
  notificationLogs: number;
  analyticsEvents: number;
  orderSnapshots: number;
  walletPasses: number;
  ticketTypes: Array<{
    id: string;
    name: string;
    quantitySold: number;
    quantityReserved: number;
    quantityReleased: number;
    quantityTotal: number;
    price: number;
  }>;
  paidRevenueOre: number;
  realCustomerPaidOrderCount: number;
};

export type ProductionGateResult = {
  blocked: boolean;
  reasons: string[];
  overrideAvailable: boolean;
  requiresProductionConfirmation: boolean;
};

export type EventTestResetResult = {
  dryRun: boolean;
  eventId: string;
  eventName: string;
  eventStatus: string;
  counts: EventTestResetCounts;
  productionGate: ProductionGateResult;
  deleted?: EventTestResetCounts;
  preserved: {
    event: true;
    quantityTotal: true;
    quantityReleased: true;
    price: true;
    eventConfig: true;
  };
};
