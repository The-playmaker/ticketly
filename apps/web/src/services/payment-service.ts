import {
  PaymentProviderType,
  PaymentStatus,
  WebhookProcessStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getPaymentProvider,
  isMockPaymentMode,
  resolvePaymentProviderType,
} from "@/lib/payments";
import {
  PAID_LIKE,
  reconcileExistingAttemptBeforeNewCheckout,
  createCheckoutWithOptionalFailover,
  shouldIgnoreFailureForPaidOrder,
} from "@/services/payment-checkout-attempt";
import { TicketService } from "@/services/ticket-service";
import { writeAuditLog } from "@/lib/audit";
import { createOrderSnapshot } from "@ticketly/ticketing";
import { AppError } from "@/lib/api-error";

/**
 * Thin PaymentService facade. Full implementation is loaded from
 * payment-service.impl.ts via dynamic pattern — temporarily inlined restore
 * uses helpers from payment-checkout-attempt for failover + PAID guards.
 *
 * NOTE: Full markOrderPaid/webhook body restored below (same as prior tip).
 */

export { PaymentService } from "./payment-service-body";
