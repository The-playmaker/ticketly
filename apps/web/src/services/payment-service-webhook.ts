import {
  PaymentProviderType,
  PaymentStatus,
  WebhookProcessStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPaymentProvider, isMockPaymentMode } from "@/lib/payments";
import { shouldIgnoreFailureForPaidOrder } from "@/services/payment-checkout-attempt";
import { writeAuditLog } from "@/lib/audit";
import { markOrderPaidImpl } from "@/services/payment-service-paid";

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
  // FAILED events are re-attempted on provider redelivery (fulfillment is
  // idempotent under the Order row lock). Previously a single failure after
  // payment meant the order never got tickets, even though Stripe retried.
  if (
    existingWebhook &&
    existingWebhook.status !== WebhookProcessStatus.RECEIVED &&
    existingWebhook.status !== WebhookProcessStatus.FAILED
  ) {
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
          amount: parsed.amount,
          currency: parsed.currency,
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
