/**
 * Checkout attempt pre-check + create-time provider failover helpers.
 * Used by PaymentService.startCheckout.
 */
import {
  PaymentProviderType,
  PaymentStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getPaymentProvider,
  resolveBackupProviderType,
  isBackupConfigured,
  shouldFailoverToBackup,
  lookupNexiForPayment,
  nexiPaymentIsPaid,
  nexiPaymentIsCancelledOrExpired,
  getNexiCheckoutKey,
  getNexiCheckoutScriptUrl,
  getNexiEnvironment,
  lookupStripeForPayment,
  createLiveStripeLookupClient,
  normalizeStripeLookupIds,
  STRIPE_CHECKOUT_SCRIPT_URL,
  getStripePublishableKey,
  retrieveStripeCheckoutClientSecret,
} from "@/lib/payments";
import { writeAuditLog } from "@/lib/audit";
import { AppError } from "@/lib/api-error";
import type { CreateCheckoutInput, CreateCheckoutResult } from "@/lib/payments/types";

/** Terminal-ish statuses that must never be overwritten by delayed failure webhooks. */
export const PAID_LIKE: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

export type CheckoutReusePayload = {
  provider: PaymentProviderType;
  sessionId: string;
  paymentId?: string | null;
  checkoutKey?: string;
  checkoutScriptUrl?: string;
  clientSecret?: string;
  integrationType: "EmbeddedCheckout" | "HostedPaymentPage";
  checkoutUrl: string;
  orderNumber: string;
  accessToken: string;
};

export type AttemptPrecheck = {
  reuse?: CheckoutReusePayload;
  attemptNumber: number;
};

/**
 * Before creating a new Payment attempt: check prior attempts so we never
 * double-charge when a previous provider session already captured.
 */
export async function reconcileExistingAttemptBeforeNewCheckout(
  orderId: string,
  markOrderPaid: (input: {
    orderId: string;
    provider: PaymentProviderType;
    providerSessionId?: string;
    providerPaymentId?: string;
    providerChargeId?: string;
    paymentMethod?: string;
    paymentType?: string;
    providerStatus?: string;
    externalEventId?: string;
    amount?: number;
    currency?: string;
  }) => Promise<unknown>
): Promise<AttemptPrecheck> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      payments: { orderBy: { createdAt: "asc" } },
      event: true,
    },
  });

  if (PAID_LIKE.includes(order.paymentStatus)) {
    throw new AppError("ORDER_ALREADY_PAID", "Ordren er allerede betalt", 409);
  }

  const attemptNumber = order.payments.length + 1;
  const open = [...order.payments]
    .reverse()
    .find(
      (p) =>
        p.status === PaymentStatus.PENDING || p.status === PaymentStatus.AUTHORIZED
    );

  if (!open) {
    return { attemptNumber };
  }

  const appUrl = (process.env.APP_URL ?? "http://localhost:3456").replace(/\/$/, "");
  const checkoutPageUrl = `${appUrl}/checkout/payment`;

  if (
    (open.provider === PaymentProviderType.NEXI ||
      open.provider === PaymentProviderType.NETS) &&
    open.providerPaymentId
  ) {
    try {
      const lookup = await lookupNexiForPayment(open.providerPaymentId);
      if (nexiPaymentIsPaid(lookup, order.total)) {
        await markOrderPaid({
          orderId: order.id,
          provider: open.provider,
          providerSessionId: open.providerSessionId ?? lookup.paymentId,
          providerPaymentId: lookup.paymentId,
          providerChargeId: lookup.chargeId ?? undefined,
          paymentMethod: lookup.paymentMethod ?? undefined,
          paymentType: lookup.paymentType ?? undefined,
          providerStatus: "reconciled_before_retry",
          externalEventId: `precheck_nexi_${lookup.paymentId}`,
          amount: lookup.chargedAmount || order.total,
          currency: lookup.currency ?? order.currency,
        });
        throw new AppError("ORDER_ALREADY_PAID", "Ordren er allerede betalt", 409);
      }
      if (nexiPaymentIsCancelledOrExpired(lookup)) {
        await prisma.payment.update({
          where: { id: open.id },
          data: {
            status: PaymentStatus.CANCELLED,
            providerStatus: lookup.terminatedAt ? "terminated" : "checkout_expired",
          },
        });
        return { attemptNumber };
      }
      return {
        attemptNumber,
        reuse: {
          provider: open.provider,
          sessionId: open.providerSessionId ?? open.providerPaymentId,
          paymentId: open.providerPaymentId,
          checkoutKey: getNexiCheckoutKey(),
          checkoutScriptUrl: getNexiCheckoutScriptUrl(getNexiEnvironment()),
          integrationType: "EmbeddedCheckout",
          checkoutUrl: `${checkoutPageUrl}?paymentId=${encodeURIComponent(open.providerPaymentId)}&orderNumber=${encodeURIComponent(order.orderNumber)}&t=${encodeURIComponent(order.accessToken)}`,
          orderNumber: order.orderNumber,
          accessToken: order.accessToken,
        },
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        "PAYMENT_STATUS_UNKNOWN",
        "Kan ikke starte ny betaling før status på eksisterende forsøk er bekreftet",
        409
      );
    }
  }

  if (open.provider === PaymentProviderType.STRIPE) {
    const ids = normalizeStripeLookupIds({
      providerSessionId: open.providerSessionId,
      providerPaymentId: open.providerPaymentId,
    });
    if (ids.sessionId || ids.paymentIntentId) {
      try {
        const lookup = await lookupStripeForPayment(createLiveStripeLookupClient(), {
          sessionId: ids.sessionId,
          paymentIntentId: ids.paymentIntentId,
        });
        const paid =
          lookup.session?.paymentStatus === "paid" ||
          lookup.paymentIntent?.status === "succeeded";
        if (paid) {
          await markOrderPaid({
            orderId: order.id,
            provider: PaymentProviderType.STRIPE,
            providerSessionId: lookup.session?.id ?? open.providerSessionId ?? undefined,
            providerPaymentId:
              lookup.paymentIntent?.id ?? open.providerPaymentId ?? undefined,
            providerChargeId: lookup.paymentIntent?.chargeId ?? undefined,
            providerStatus: "reconciled_before_retry",
            externalEventId: `precheck_stripe_${lookup.paymentIntent?.id ?? lookup.session?.id}`,
            amount: lookup.paymentIntent?.amount ?? lookup.session?.amountTotal ?? order.total,
            currency:
              lookup.paymentIntent?.currency ??
              lookup.session?.currency ??
              order.currency,
          });
          throw new AppError("ORDER_ALREADY_PAID", "Ordren er allerede betalt", 409);
        }
        const expired = lookup.session?.status === "expired";
        const canceled = lookup.paymentIntent?.status === "canceled";
        if (expired || canceled) {
          await prisma.payment.update({
            where: { id: open.id },
            data: {
              status: PaymentStatus.CANCELLED,
              providerStatus: expired ? "session_expired" : "canceled",
            },
          });
          return { attemptNumber };
        }
        if (ids.sessionId && lookup.session?.status === "open") {
          let clientSecret: string | undefined;
          try {
            clientSecret = await retrieveStripeCheckoutClientSecret(ids.sessionId);
          } catch {
            clientSecret = undefined;
          }
          return {
            attemptNumber,
            reuse: {
              provider: PaymentProviderType.STRIPE,
              sessionId: ids.sessionId,
              paymentId: lookup.paymentIntent?.id,
              clientSecret,
              checkoutKey: getStripePublishableKey(),
              checkoutScriptUrl: STRIPE_CHECKOUT_SCRIPT_URL,
              integrationType: "EmbeddedCheckout",
              checkoutUrl: `${checkoutPageUrl}?paymentId=${encodeURIComponent(ids.sessionId)}&orderNumber=${encodeURIComponent(order.orderNumber)}&t=${encodeURIComponent(order.accessToken)}`,
              orderNumber: order.orderNumber,
              accessToken: order.accessToken,
            },
          };
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(
          "PAYMENT_STATUS_UNKNOWN",
          "Kan ikke starte ny betaling før status på eksisterende forsøk er bekreftet",
          409
        );
      }
    }
  }

  return { attemptNumber };
}

export type FailoverCheckoutResult = CreateCheckoutResult & {
  usedProvider: PaymentProviderType;
  failoverFrom: PaymentProviderType | null;
  failoverReason: string | null;
  attemptNumber: number;
};

/** Create checkout on primary; failover to backup only when definitively unavailable. */
export async function createCheckoutWithOptionalFailover(input: {
  orderId: string;
  organizationId: string;
  providerType: PaymentProviderType;
  attemptNumber: number;
  checkoutInput: CreateCheckoutInput;
}): Promise<FailoverCheckoutResult> {
  const { orderId, organizationId, providerType, attemptNumber, checkoutInput } = input;

  try {
    const result = await getPaymentProvider(providerType).createCheckout(checkoutInput);
    return {
      ...result,
      usedProvider: providerType,
      failoverFrom: null,
      failoverReason: null,
      attemptNumber,
    };
  } catch (primaryError) {
    const backup = resolveBackupProviderType(providerType);
    const canFailover =
      backup != null &&
      isBackupConfigured(backup) &&
      shouldFailoverToBackup(primaryError);

    if (!canFailover || !backup) {
      if (process.env.NODE_ENV === "production") {
        const msg =
          primaryError instanceof Error ? primaryError.message : "Payment provider error";
        if (
          msg.includes("not configured") ||
          msg.includes("NEXI_") ||
          msg.includes("placeholder")
        ) {
          throw new AppError(
            "PAYMENT_CONFIG_ERROR",
            "Betaling er midlertidig utilgjengelig (konfigurasjon)",
            503
          );
        }
      }
      throw primaryError;
    }

    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { paymentStatus: true, paymentAnomaly: true },
    });
    if (PAID_LIKE.includes(fresh.paymentStatus) || fresh.paymentAnomaly) {
      throw new AppError("ORDER_ALREADY_PAID", "Ordren er allerede betalt", 409);
    }

    const failoverReason =
      primaryError instanceof Error
        ? primaryError.message.slice(0, 200)
        : "primary_unavailable";

    const result = await getPaymentProvider(backup).createCheckout({
      ...checkoutInput,
      metadata: {
        ...(checkoutInput.metadata ?? {}),
        failoverFrom: providerType,
        attempt: String(attemptNumber),
      },
      idempotencyKey: `create_${orderId}_a${attemptNumber}_${backup}`.slice(0, 64),
    });

    await writeAuditLog({
      action: "PAYMENT_PROVIDER_FAILOVER",
      entityType: "Order",
      entityId: orderId,
      organizationId,
      metadata: {
        from: providerType,
        to: backup,
        reason: failoverReason,
        attemptNumber,
        phase: "before_payment_creation",
      },
    });

    return {
      ...result,
      usedProvider: backup,
      failoverFrom: providerType,
      failoverReason,
      attemptNumber,
    };
  }
}

/** Never downgrade a paid-like order on delayed failure/cancel webhooks. */
export async function shouldIgnoreFailureForPaidOrder(
  orderId: string
): Promise<{ ignore: boolean; keptStatus?: PaymentStatus }> {
  const current = await prisma.order.findUnique({
    where: { id: orderId },
    select: { paymentStatus: true },
  });
  if (current && PAID_LIKE.includes(current.paymentStatus)) {
    return { ignore: true, keptStatus: current.paymentStatus };
  }
  return { ignore: false };
}
