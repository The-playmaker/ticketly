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
import { TicketService } from "@/services/ticket-service";
import { writeAuditLog } from "@/lib/audit";
import { createOrderSnapshot } from "@ticketly/ticketing";
import { AppError } from "@/lib/api-error";

function buildCheckoutItems(
  items: Array<{
    ticketTypeId: string;
    quantity: number;
    unitPrice: number;
    serviceFee: number;
    tax: number;
    total: number;
    name: string;
  }>,
  serviceFeeTotal: number,
  currencyIgnored: string
) {
  void currencyIgnored;
  const lines = items.map((item) => {
    const net = item.unitPrice * item.quantity;
    const tax = item.tax;
    const gross = item.total - item.serviceFee;
    return {
      reference: item.ticketTypeId,
      name: item.name,
      quantity: item.quantity,
      unit: "pcs",
      unitPrice: item.unitPrice,
      taxRate: 0,
      taxAmount: tax,
      grossTotalAmount: gross > 0 ? gross : item.unitPrice * item.quantity + tax,
      netTotalAmount: net,
    };
  });

  if (serviceFeeTotal > 0) {
    lines.push({
      reference: "service-fee",
      name: "Serviceavgift",
      quantity: 1,
      unit: "pcs",
      unitPrice: serviceFeeTotal,
      taxRate: 0,
      taxAmount: 0,
      grossTotalAmount: serviceFeeTotal,
      netTotalAmount: serviceFeeTotal,
    });
  }

  return lines;
}

export class PaymentService {
  static assertMockAllowed() {
    if (isMockPaymentMode()) {
      if (process.env.NODE_ENV === "production") {
        throw new AppError(
          "MOCK_PAYMENTS_DISABLED",
          "Mock payments are forbidden in production",
          403
        );
      }
    }
  }

  static async startCheckout(
    orderId: string,
    providerType: PaymentProviderType = resolvePaymentProviderType()
  ) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { event: true, items: { include: { ticketType: true } } },
    });

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new AppError("ORDER_ALREADY_PAID", "Ordren er allerede betalt", 409);
    }
    if (
      order.paymentStatus === PaymentStatus.REVIEW_REQUIRED ||
      order.paymentAnomaly
    ) {
      throw new AppError("PAYMENT_ANOMALY", "Ordren er sperret for manuell gjennomgang", 409);
    }

    // Free orders: only if every ticket type is publicly purchasable at zero
    if (order.total === 0) {
      const allPublic = order.items.every((i) => i.ticketType.isPubliclyPurchasable);
      if (!allPublic) {
        throw new AppError(
          "FREE_TICKET_NOT_PUBLIC",
          "Gratisbilletter kan ikke kjøpes offentlig",
          403
        );
      }
      await this.markOrderPaid({
        orderId: order.id,
        provider: providerType,
        providerSessionId: `free_${order.id}`,
        providerPaymentId: `free_${order.id}`,
        externalEventId: `free_${order.id}`,
        amount: 0,
        currency: order.currency,
      });
      const appUrl = process.env.APP_URL ?? "http://localhost:3456";
      return {
        checkoutUrl: `${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}&paid=1`,
        sessionId: `free_${order.id}`,
        paymentId: `free_${order.id}`,
        provider: providerType,
        integrationType: "HostedPaymentPage" as const,
        checkoutKey: undefined as string | undefined,
        checkoutScriptUrl: undefined as string | undefined,
        orderNumber: order.orderNumber,
        accessToken: order.accessToken,
      };
    }

    if (providerType === PaymentProviderType.MOCK || isMockPaymentMode()) {
      this.assertMockAllowed();
    }

    // Production must never silently fall back to mock when Nexi/Stripe misconfigured
    if (process.env.NODE_ENV === "production" && providerType === PaymentProviderType.MOCK) {
      throw new AppError(
        "PAYMENT_CONFIG_ERROR",
        "Betaling er ikke konfigurert for produksjon",
        503
      );
    }

    const provider = getPaymentProvider(providerType);
    const appUrl = (process.env.APP_URL ?? "http://localhost:3456").replace(/\/$/, "");
    const checkoutPageUrl = `${appUrl}/checkout/payment`;

    const items = buildCheckoutItems(
      order.items,
      order.serviceFee,
      order.currency
    );
    // Ensure items sum equals order.total (adjust last line for rounding / discount)
    const sum = items.reduce((s, i) => s + i.grossTotalAmount, 0);
    if (sum !== order.total && items.length > 0) {
      const delta = order.total - sum;
      const last = items[items.length - 1]!;
      last.grossTotalAmount += delta;
      last.netTotalAmount += delta;
      last.unitPrice = Math.round(last.netTotalAmount / Math.max(1, last.quantity));
    }

    let result;
    try {
      result = await provider.createCheckout({
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount: order.total,
        currency: order.currency,
        customerEmail: order.customerEmail,
        customerName: `${order.customerFirstName} ${order.customerLastName}`,
        customerFirstName: order.customerFirstName,
        customerLastName: order.customerLastName,
        customerPhone: order.customerPhone ?? undefined,
        description: `${order.event.name} – ${order.orderNumber}`,
        successUrl: `${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}&checkout=success`,
        cancelUrl: `${appUrl}/checkout?event=${order.event.slug}&cancelled=1`,
        checkoutPageUrl,
        termsUrl: `${appUrl}/terms`,
        merchantTermsUrl: `${appUrl}/privacy`,
        items,
        metadata: { eventId: order.eventId },
      });
    } catch (e) {
      if (process.env.NODE_ENV === "production") {
        const msg = e instanceof Error ? e.message : "Payment provider error";
        if (msg.includes("not configured") || msg.includes("NEXI_")) {
          throw new AppError(
            "PAYMENT_CONFIG_ERROR",
            "Betaling er midlertidig utilgjengelig (konfigurasjon)",
            503
          );
        }
      }
      throw e;
    }

    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: providerType,
        providerSessionId: result.sessionId,
        providerPaymentId: result.paymentId ?? result.sessionId,
        amount: order.total,
        currency: order.currency,
        status: PaymentStatus.PENDING,
        providerStatus: "created",
        idempotencyKey: `checkout_${order.id}_${result.sessionId}`,
        providerMetadata: {
          integrationType: result.integrationType ?? null,
        },
      },
    });

    return {
      ...result,
      checkoutUrl:
        result.checkoutUrl ??
        `${checkoutPageUrl}?paymentId=${encodeURIComponent(result.paymentId ?? result.sessionId)}&orderNumber=${encodeURIComponent(order.orderNumber)}&t=${encodeURIComponent(order.accessToken)}`,
      orderNumber: order.orderNumber,
      accessToken: order.accessToken,
    };
  }

  static async handleProviderWebhook(input: {
    provider: PaymentProviderType;
    rawBody: string | Buffer;
    signature: string | null;
  }) {
    if (isMockPaymentMode() && input.signature === "mock") {
      this.assertMockAllowed();
    }

    const provider = getPaymentProvider(input.provider);
    const parsed = await provider.parseWebhook(input.rawBody, input.signature);

    const existingWebhook = await prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: input.provider,
          eventId: parsed.externalEventId,
        },
      },
    });
    if (existingWebhook?.status === WebhookProcessStatus.PROCESSED) {
      return { duplicate: true, type: parsed.type };
    }
    if (existingWebhook && existingWebhook.status === WebhookProcessStatus.RECEIVED) {
      // Crash recovery: allow reprocessing if never marked PROCESSED
    } else if (existingWebhook) {
      return { duplicate: true, type: parsed.type };
    }

    let webhookRowId: string | undefined;
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
        // Race: another worker inserted the same event id
        const again = await prisma.webhookEvent.findUnique({
          where: {
            provider_eventId: {
              provider: input.provider,
              eventId: parsed.externalEventId,
            },
          },
        });
        if (again?.status === WebhookProcessStatus.PROCESSED) {
          return { duplicate: true, type: parsed.type };
        }
        webhookRowId = again?.id;
      }
    } else {
      webhookRowId = existingWebhook.id;
    }

    if (!parsed.handled) {
      if (webhookRowId) {
        await prisma.webhookEvent.update({
          where: { id: webhookRowId },
          data: {
            status: WebhookProcessStatus.SKIPPED,
            processedAt: new Date(),
          },
        });
      }
      return { duplicate: false, type: parsed.type, skipped: true };
    }

    try {
      // Resolve order via payment id when orderId not in payload
      let orderId = parsed.orderId;
      if (!orderId && (parsed.providerPaymentId || parsed.providerSessionId)) {
        const payment = await prisma.payment.findFirst({
          where: {
            OR: [
              parsed.providerPaymentId
                ? { providerPaymentId: parsed.providerPaymentId }
                : undefined,
              parsed.providerSessionId
                ? { providerSessionId: parsed.providerSessionId }
                : undefined,
            ].filter(Boolean) as object[],
          },
        });
        orderId = payment?.orderId;
      }

      // Persist charge id / method metadata early
      if (parsed.providerPaymentId || parsed.providerSessionId) {
        const payment = await prisma.payment.findFirst({
          where: {
            OR: [
              parsed.providerPaymentId
                ? { providerPaymentId: parsed.providerPaymentId }
                : undefined,
              parsed.providerSessionId
                ? { providerSessionId: parsed.providerSessionId }
                : undefined,
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
              providerMetadata: {
                ...((payment.providerMetadata as object) ?? {}),
                lastEvent: parsed.type,
              },
            },
          });
        }
      }

      if (
        (parsed.paymentStatus === PaymentStatus.PAID ||
          parsed.paymentStatus === PaymentStatus.AUTHORIZED) &&
        orderId
      ) {
        // With charge:true, AUTHORIZED is intermediate; PAID issues tickets.
        // If only AUTHORIZED arrives (no charge yet), store status but don't fulfill.
        if (parsed.paymentStatus === PaymentStatus.AUTHORIZED) {
          await prisma.payment.updateMany({
            where: {
              orderId,
              status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] },
            },
            data: {
              status: PaymentStatus.AUTHORIZED,
              providerStatus: parsed.type,
              providerPaymentId: parsed.providerPaymentId,
            },
          });
        } else {
          await this.markOrderPaid({
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
        await prisma.order.update({
          where: { id: orderId },
          data: { paymentStatus: PaymentStatus.FAILED },
        });
        await prisma.payment.updateMany({
          where: { orderId },
          data: { status: PaymentStatus.FAILED, providerStatus: parsed.type },
        });
      }

      if (parsed.paymentStatus === PaymentStatus.CANCELLED && orderId) {
        await prisma.order.update({
          where: { id: orderId },
          data: { paymentStatus: PaymentStatus.CANCELLED },
        });
        await prisma.payment.updateMany({
          where: { orderId },
          data: { status: PaymentStatus.CANCELLED, providerStatus: parsed.type },
        });
        await writeAuditLog({
          action: "PAYMENT_CANCELLED",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            provider: input.provider,
            providerPaymentId: parsed.providerPaymentId,
            // Cancellation ≠ refund — no capture happened
            kind: "provider_cancel",
          },
        });
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
          // Only mark fully REFUNDED from webhook if we already track refunds covering amount
          const succeeded = await prisma.refund.aggregate({
            where: { orderId: payment.orderId, status: "SUCCEEDED" },
            _sum: { amount: true },
          });
          const refundedSum = succeeded._sum.amount ?? 0;
          const nextStatus =
            refundedSum >= payment.amount
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED;
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

  /** Safe replay of our own webhook processing for failed/received events (idempotent). */
  static async replayWebhookEvent(webhookEventId: string) {
    const row = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: webhookEventId },
    });
    if (row.status === WebhookProcessStatus.PROCESSED) {
      return { duplicate: true, type: row.eventType };
    }
    // Re-run using stored payload — does not re-fetch from provider
    await prisma.webhookEvent.update({
      where: { id: row.id },
      data: { status: WebhookProcessStatus.RECEIVED, error: null },
    });
    const stored = (row.payload ?? {}) as Record<string, unknown>;
    return this.handleProviderWebhook({
      provider: row.provider,
      rawBody: JSON.stringify({
        id: row.eventId,
        event: row.eventType,
        data: {
          ...stored,
          paymentId: row.paymentId ?? stored.paymentId,
          chargeId: stored.chargeId,
          amount:
            stored.amount ??
            (stored.amount !== undefined
              ? stored.amount
              : undefined),
        },
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

  static async markOrderPaid(input: {
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
  }) {
    const order = await prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new AppError("ORDER_NOT_FOUND", "Order not found", 404);

    if (order.paymentStatus === PaymentStatus.PAID && !order.paymentAnomaly) {
      await TicketService.issueTicketsForPaidOrder(order.id);
      return order;
    }

    // Verify provider payment belongs to this order
    if (input.providerPaymentId) {
      const linked = await prisma.payment.findFirst({
        where: {
          providerPaymentId: input.providerPaymentId,
          NOT: { orderId: order.id },
        },
      });
      if (linked) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: PaymentStatus.REVIEW_REQUIRED,
            paymentAnomaly: true,
            paymentAnomalyReason: "PAYMENT_ORDER_MISMATCH",
          },
        });
        await writeAuditLog({
          action: "PAYMENT_ORDER_MISMATCH",
          entityType: "Order",
          entityId: order.id,
          organizationId: order.organizationId,
          metadata: {
            providerPaymentId: input.providerPaymentId,
            otherOrderId: linked.orderId,
          },
        });
        throw new AppError("PAYMENT_ORDER_MISMATCH", "Betaling tilhører ikke ordren", 409);
      }
    }

    // Amount / currency integrity — never issue tickets on mismatch
    if (input.amount != null && input.amount !== order.total) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED,
          paymentAnomaly: true,
          paymentAnomalyReason: `AMOUNT_MISMATCH expected=${order.total} got=${input.amount}`,
        },
      });
      await writeAuditLog({
        action: "PAYMENT_AMOUNT_MISMATCH",
        entityType: "Order",
        entityId: order.id,
        organizationId: order.organizationId,
        metadata: {
          reason: "AMOUNT_MISMATCH",
          expected: order.total,
          got: input.amount,
          externalEventId: input.externalEventId,
        },
      });
      throw new AppError("PAYMENT_AMOUNT_MISMATCH", "Betalingsbeløp matcher ikke ordre", 409);
    }

    if (input.currency && input.currency.toUpperCase() !== order.currency.toUpperCase()) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.REVIEW_REQUIRED,
          paymentAnomaly: true,
          paymentAnomalyReason: `CURRENCY_MISMATCH expected=${order.currency} got=${input.currency}`,
        },
      });
      await writeAuditLog({
        action: "PAYMENT_CURRENCY_MISMATCH",
        entityType: "Order",
        entityId: order.id,
        organizationId: order.organizationId,
        metadata: { reason: "CURRENCY_MISMATCH", expected: order.currency, got: input.currency },
      });
      throw new AppError("PAYMENT_CURRENCY_MISMATCH", "Valuta matcher ikke ordre", 409);
    }

    if (order.paymentAnomaly) {
      throw new AppError("PAYMENT_ANOMALY", "Ordren er sperret", 409);
    }

    await prisma.$transaction(async (tx) => {
      // Lock order row — prevent reservation cleanup race from freeing paid inventory
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;

      const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (fresh.paymentStatus === PaymentStatus.PAID) {
        return;
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          paidAt: new Date(),
        },
      });

      const existing = await tx.payment.findFirst({
        where: {
          orderId: order.id,
          OR: [
            input.providerSessionId ? { providerSessionId: input.providerSessionId } : undefined,
            input.providerPaymentId ? { providerPaymentId: input.providerPaymentId } : undefined,
            { orderId: order.id },
          ].filter(Boolean) as object[],
        },
        orderBy: { createdAt: "desc" },
      });

      if (existing) {
        await tx.payment.update({
          where: { id: existing.id },
          data: {
            status: PaymentStatus.PAID,
            providerPaymentId: input.providerPaymentId ?? existing.providerPaymentId,
            providerSessionId: input.providerSessionId ?? existing.providerSessionId,
            providerChargeId: input.providerChargeId ?? existing.providerChargeId,
            paymentMethod: input.paymentMethod ?? existing.paymentMethod,
            paymentType: input.paymentType ?? existing.paymentType,
            providerStatus: input.providerStatus ?? existing.providerStatus,
          },
        });
      } else {
        await tx.payment.create({
          data: {
            orderId: order.id,
            provider: input.provider,
            providerSessionId: input.providerSessionId,
            providerPaymentId: input.providerPaymentId,
            providerChargeId: input.providerChargeId,
            paymentMethod: input.paymentMethod,
            paymentType: input.paymentType,
            providerStatus: input.providerStatus,
            amount: input.amount ?? order.total,
            currency: order.currency,
            status: PaymentStatus.PAID,
            idempotencyKey: input.externalEventId
              ? `paid_${input.externalEventId}`
              : `paid_${order.id}_${Date.now()}`,
          },
        });
      }

      // Convert any ACTIVE reservations on this order so cleanup cannot free them
      await tx.ticketReservation.updateMany({
        where: { orderId: order.id, status: "ACTIVE" },
        data: { status: "CONVERTED" },
      });
    });

    await TicketService.issueTicketsForPaidOrder(order.id);
    try {
      await createOrderSnapshot(order.id);
    } catch (e) {
      console.error("OrderSnapshot failed", e);
    }
    return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }
}
