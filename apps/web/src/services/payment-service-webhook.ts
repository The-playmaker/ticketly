import {
  PaymentProviderType,
  PaymentStatus,
  WebhookProcessStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getPaymentProvider,
  isMockPaymentMode,
  lookupNexiForPayment,
  lookupStripeForPayment,
  createLiveStripeLookupClient,
} from "@/lib/payments";
import { shouldIgnoreFailureForPaidOrder } from "@/services/payment-checkout-attempt";
import { writeAuditLog } from "@/lib/audit";
import { markOrderPaidImpl } from "@/services/payment-service-paid";
import { PromoService } from "@/services/promo-service";

/** When webhook payload omits amount/currency, fetch from Nexi/Stripe before markOrderPaid. */
async function resolveWebhookAmountCurrency(input: {
  provider: PaymentProviderType;
  amount?: number;
  currency?: string;
  providerPaymentId?: string;
  providerSessionId?: string;
}): Promise<{ amount?: number; currency?: string }> {
  let amount = input.amount;
  let currency = input.currency;
  if (amount != null && currency?.trim()) return { amount, currency };

  try {
    if (
      (input.provider === PaymentProviderType.NEXI ||
        input.provider === PaymentProviderType.NETS) &&
      input.providerPaymentId
    ) {
      const lookup = await lookupNexiForPayment(input.providerPaymentId);
      if (amount == null) {
        amount = lookup.chargedAmount || lookup.amount || undefined;
      }
      currency = currency ?? lookup.currency ?? undefined;
    } else if (input.provider === PaymentProviderType.STRIPE) {
      const lookup = await lookupStripeForPayment(createLiveStripeLookupClient(), {
        sessionId: input.providerSessionId,
        paymentIntentId: input.providerPaymentId,
      });
      amount =
        amount ??
        lookup.paymentIntent?.amount ??
        lookup.session?.amountTotal ??
        undefined;
      currency =
        currency ??
        lookup.paymentIntent?.currency ??
        lookup.session?.currency ??
        undefined;
    }
  } catch (e) {
    console.error("[webhook] amount fetch failed", e);
  }
  return { amount, currency };
}

function assertMockAllowedImpl() {
  if (isMockPaymentMode() && process.env.NODE_ENV === "production") {
    throw new Error("Mock payments are forbidden in production");
  }
}

export async function handleProviderWebhookImpl(input: {
  provider: PaymentProviderType;
  rawBody: string | Buffer;
  signature: string | null;
}) {
  if (isMockPaymentMode() && input.signature === "mock") assertMockAllowedImpl();
  const provider = getPaymentProvider(input.provider);
  const parsed = await provider.parseWebhook(input.rawBody, input.signature);
  const existingWebhook = await prisma.webhookEvent.findUnique({
    where: { provider_eventId: { provider: input.provider, eventId: parsed.externalEventId } },
  });
  if (existingWebhook?.status === WebhookProcessStatus.PROCESSED) {
    return { duplicate: true, type: parsed.type };
  }
  if (existingWebhook && existingWebhook.status !== WebhookProcessStatus.RECEIVED) {
    return { duplicate: true, type: parsed.type };
  }
  let webhookRowId = existingWebhook?.id;
  if (!existingWebhook) {
    try {
      const row = await prisma.webhookEvent.create({
        data: {
          provider: input.provider,
          eventId: parsed.externalEventId,
          eventType: parsed.type,
          paymentId: parsed.providerPaymentId,
          orderId: parsed.orderId,
          payload: (parsed.raw as object) ?? {},
          status: WebhookProcessStatus.RECEIVED,
          receivedAt: new Date(),
        },
      });
      webhookRowId = row.id;
    } catch {
      const again = await prisma.webhookEvent.findUnique({
        where: { provider_eventId: { provider: input.provider, eventId: parsed.externalEventId } },
      });
      if (again?.status === WebhookProcessStatus.PROCESSED) {
        return { duplicate: true, type: parsed.type };
      }
      webhookRowId = again?.id;
    }
  }
  if (!parsed.handled) {
    if (webhookRowId) {
      await prisma.webhookEvent.update({
        where: { id: webhookRowId },
        data: { status: WebhookProcessStatus.SKIPPED, processedAt: new Date() },
      });
    }
    return { duplicate: false, type: parsed.type, skipped: true };
  }
  try {
    let orderId = parsed.orderId;
    if (!orderId && (parsed.providerPaymentId || parsed.providerSessionId)) {
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            parsed.providerPaymentId ? { providerPaymentId: parsed.providerPaymentId } : undefined,
            parsed.providerSessionId ? { providerSessionId: parsed.providerSessionId } : undefined,
          ].filter(Boolean) as object[],
        },
      });
      orderId = payment?.orderId;
    }
    if (parsed.providerPaymentId || parsed.providerSessionId) {
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            parsed.providerPaymentId ? { providerPaymentId: parsed.providerPaymentId } : undefined,
            parsed.providerSessionId ? { providerSessionId: parsed.providerSessionId } : undefined,
          ].filter(Boolean) as object[],
        },
      });
      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            providerChargeId: parsed.providerChargeId ?? payment.providerChargeId,
            paymentMethod: parsed.paymentMethod ?? payment.paymentMethod,
            paymentType: parsed.paymentType ?? payment.paymentType,
            providerStatus: parsed.providerStatus ?? parsed.type,
            providerMetadata: { ...((payment.providerMetadata as object) ?? {}), lastEvent: parsed.type },
          },
        });
      }
    }
    if (
      (parsed.paymentStatus === PaymentStatus.PAID || parsed.paymentStatus === PaymentStatus.AUTHORIZED) &&
      orderId
    ) {
      if (parsed.paymentStatus === PaymentStatus.AUTHORIZED) {
        await prisma.payment.updateMany({
          where: { orderId, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
          data: {
            status: PaymentStatus.AUTHORIZED,
            providerStatus: parsed.type,
            providerPaymentId: parsed.providerPaymentId,
          },
        });
      } else {
        const resolved = await resolveWebhookAmountCurrency({
          provider: input.provider,
          amount: parsed.amount,
          currency: parsed.currency,
          providerPaymentId: parsed.providerPaymentId,
          providerSessionId: parsed.providerSessionId,
        });
        await markOrderPaidImpl({
          orderId,
          provider: input.provider,
          providerSessionId: parsed.providerSessionId,
          providerPaymentId: parsed.providerPaymentId,
          providerChargeId: parsed.providerChargeId,
          paymentMethod: parsed.paymentMethod,
          paymentType: parsed.paymentType,
          providerStatus: parsed.providerStatus ?? parsed.type,
          externalEventId: parsed.externalEventId,
          amount: resolved.amount,
          currency: resolved.currency,
        });
      }
    }
    if (parsed.paymentStatus === PaymentStatus.FAILED && orderId) {
      const paidGuard = await shouldIgnoreFailureForPaidOrder(orderId);
      if (paidGuard.ignore) {
        await writeAuditLog({
          action: "PAYMENT_FAILURE_IGNORED_ALREADY_PAID",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            provider: input.provider,
            providerPaymentId: parsed.providerPaymentId,
            eventType: parsed.type,
            keptStatus: paidGuard.keptStatus,
          },
        });
      } else {
        await prisma.order.update({ where: { id: orderId }, data: { paymentStatus: PaymentStatus.FAILED } });
        await prisma.payment.updateMany({
          where: {
            orderId,
            status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED] },
          },
          data: { status: PaymentStatus.FAILED, providerStatus: parsed.type },
        });
        await PromoService.releasePromoForOrder(orderId, undefined, "PAYMENT_FAILED");
      }
    }
    if (parsed.paymentStatus === PaymentStatus.CANCELLED && orderId) {
      const paidGuard = await shouldIgnoreFailureForPaidOrder(orderId);
      if (paidGuard.ignore) {
        await writeAuditLog({
          action: "PAYMENT_CANCEL_IGNORED_ALREADY_PAID",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            provider: input.provider,
            providerPaymentId: parsed.providerPaymentId,
            eventType: parsed.type,
            keptStatus: paidGuard.keptStatus,
          },
        });
      } else {
        await prisma.order.update({
          where: { id: orderId },
          data: { paymentStatus: PaymentStatus.CANCELLED },
        });
        await prisma.payment.updateMany({
          where: {
            orderId,
            status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED, PaymentStatus.CANCELLED] },
          },
          data: { status: PaymentStatus.CANCELLED, providerStatus: parsed.type },
        });
        await PromoService.releasePromoForOrder(orderId, undefined, "PAYMENT_CANCELLED");
        await writeAuditLog({
          action: "PAYMENT_CANCELLED",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            provider: input.provider,
            providerPaymentId: parsed.providerPaymentId,
            kind: "provider_cancel",
          },
        });
      }
    }
    if (
      (parsed.paymentStatus === PaymentStatus.REFUNDED ||
        parsed.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED) &&
      (parsed.providerPaymentId || orderId)
    ) {
      const payment = await prisma.payment.findFirst({
        where: parsed.providerPaymentId
          ? { providerPaymentId: parsed.providerPaymentId }
          : { orderId: orderId! },
      });
      if (payment) {
        const succeeded = await prisma.refund.aggregate({
          where: { orderId: payment.orderId, status: "SUCCEEDED" },
          _sum: { amount: true },
        });
        const refundedSum = succeeded._sum.amount ?? 0;
        const nextStatus =
          refundedSum >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: nextStatus, providerStatus: parsed.type },
        });
      }
    }
    if (webhookRowId) {
      await prisma.webhookEvent.update({
        where: { id: webhookRowId },
        data: {
          status: WebhookProcessStatus.PROCESSED,
          processedAt: new Date(),
          orderId: orderId ?? undefined,
          paymentId: parsed.providerPaymentId ?? undefined,
        },
      });
    }
    return { duplicate: false, type: parsed.type, orderId };
  } catch (e) {
    if (webhookRowId) {
      await prisma.webhookEvent.update({
        where: { id: webhookRowId },
        data: {
          status: WebhookProcessStatus.FAILED,
          error: e instanceof Error ? e.message.slice(0, 500) : "processing_failed",
        },
      });
    }
    throw e;
  }
}

export async function replayWebhookEventImpl(webhookEventId: string) {
  const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: webhookEventId } });
  if (row.status === WebhookProcessStatus.PROCESSED) return { duplicate: true, type: row.eventType };
  await prisma.webhookEvent.update({
    where: { id: row.id },
    data: { status: WebhookProcessStatus.RECEIVED, error: null },
  });
  const stored = (row.payload ?? {}) as Record<string, unknown>;
  return handleProviderWebhookImpl({
    provider: row.provider,
    rawBody: JSON.stringify({
      id: row.eventId,
      event: row.eventType,
      data: { ...stored, paymentId: row.paymentId ?? stored.paymentId, chargeId: stored.chargeId },
    }),
    signature:
      row.provider === PaymentProviderType.NEXI || row.provider === PaymentProviderType.NETS
        ? process.env.NEXI_WEBHOOK_SECRET ?? null
        : row.provider === PaymentProviderType.STRIPE && isMockPaymentMode()
          ? "mock"
          : row.provider === PaymentProviderType.MOCK
            ? "mock"
            : process.env.STRIPE_WEBHOOK_SECRET
              ? "replay-unsupported-use-provider-dashboard"
              : "mock",
  });
}
