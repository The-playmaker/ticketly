import {
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
  ReminderJobStatus,
  ReminderKind,
  PaymentStatus,
  OrderStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEmailProvider } from "@/lib/email/provider";
import { writeAuditLog } from "@/lib/audit";

/**
 * Transactional notifications + event reminders.
 * Marketing must never be mixed into these paths.
 */
export class NotificationService {
  static async logAndSend(input: {
    to: string;
    toName?: string;
    subject: string;
    html: string;
    text?: string;
    category?: NotificationCategory;
    orderId?: string;
    eventId?: string;
    userId?: string;
  }) {
    const log = await prisma.notificationLog.create({
      data: {
        userId: input.userId,
        orderId: input.orderId,
        eventId: input.eventId,
        channel: NotificationChannel.EMAIL,
        category: input.category ?? NotificationCategory.TRANSACTIONAL,
        title: input.subject,
        body: input.text ?? input.html.slice(0, 500),
        status: NotificationDeliveryStatus.QUEUED,
        provider: process.env.EMAIL_PROVIDER ?? "console",
      },
    });

    try {
      const result = await getEmailProvider().send({
        to: { email: input.to, name: input.toName },
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          status: NotificationDeliveryStatus.SENT,
          externalId: result.id,
          sentAt: new Date(),
        },
      });
      return { ok: true as const, logId: log.id };
    } catch (e) {
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          status: NotificationDeliveryStatus.FAILED,
          error: e instanceof Error ? e.message : "send_failed",
        },
      });
      return { ok: false as const, logId: log.id };
    }
  }

  /** Schedule 24h/3h reminders for paid orders on an event (idempotent). */
  static async scheduleEventReminders(eventId: string) {
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    const orders = await prisma.order.findMany({
      where: {
        eventId,
        paymentStatus: PaymentStatus.PAID,
        orderStatus: { in: [OrderStatus.CONFIRMED, OrderStatus.PENDING] },
      },
      select: { id: true },
    });

    const jobs = [];
    for (const order of orders) {
      if (event.reminder24hEnabled) {
        const scheduledFor = new Date(event.startsAt.getTime() - 24 * 60 * 60_000);
        if (scheduledFor > new Date()) {
          jobs.push(
            prisma.eventReminderJob.upsert({
              where: {
                eventId_orderId_kind: {
                  eventId,
                  orderId: order.id,
                  kind: ReminderKind.EVENT_24H,
                },
              },
              create: {
                eventId,
                orderId: order.id,
                kind: ReminderKind.EVENT_24H,
                scheduledFor,
                status: ReminderJobStatus.SCHEDULED,
              },
              update: { scheduledFor, status: ReminderJobStatus.SCHEDULED },
            })
          );
        }
      }
      if (event.reminder3hEnabled && event.doorsOpenAt) {
        const scheduledFor = new Date(event.doorsOpenAt.getTime() - 3 * 60 * 60_000);
        if (scheduledFor > new Date()) {
          jobs.push(
            prisma.eventReminderJob.upsert({
              where: {
                eventId_orderId_kind: {
                  eventId,
                  orderId: order.id,
                  kind: ReminderKind.EVENT_3H,
                },
              },
              create: {
                eventId,
                orderId: order.id,
                kind: ReminderKind.EVENT_3H,
                scheduledFor,
                status: ReminderJobStatus.SCHEDULED,
              },
              update: { scheduledFor, status: ReminderJobStatus.SCHEDULED },
            })
          );
        }
      }
    }
    await Promise.all(jobs);
    return { scheduled: jobs.length };
  }

  /** Process due reminder jobs — safe to call from cron. */
  static async processDueReminders(limit = 50) {
    const due = await prisma.eventReminderJob.findMany({
      where: {
        status: ReminderJobStatus.SCHEDULED,
        scheduledFor: { lte: new Date() },
      },
      take: limit,
      orderBy: { scheduledFor: "asc" },
      include: {
        event: true,
      },
    });

    let sent = 0;
    for (const job of due) {
      const order = await prisma.order.findUnique({ where: { id: job.orderId } });
      if (!order || order.paymentStatus !== PaymentStatus.PAID) {
        await prisma.eventReminderJob.update({
          where: { id: job.id },
          data: { status: ReminderJobStatus.SKIPPED },
        });
        continue;
      }

      const when =
        job.kind === ReminderKind.EVENT_24H
          ? "i morgen"
          : job.kind === ReminderKind.EVENT_3H
            ? "om få timer"
            : "";
      const appUrl = process.env.APP_URL ?? "http://localhost:3456";
      const result = await this.logAndSend({
        to: order.customerEmail,
        toName: `${order.customerFirstName} ${order.customerLastName}`,
        subject: `${job.event.name} starter ${when}`.trim(),
        html: `<p>Hei ${order.customerFirstName},</p><p><strong>${job.event.name}</strong> starter snart.</p><p><a href="${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}">Se billettene dine</a></p>`,
        text: `${job.event.name} starter snart. Se billetter: ${appUrl}/orders/${order.orderNumber}?t=${order.accessToken}`,
        category: NotificationCategory.SERVICE,
        orderId: order.id,
        eventId: job.eventId,
      });

      await prisma.eventReminderJob.update({
        where: { id: job.id },
        data: result.ok
          ? { status: ReminderJobStatus.SENT, sentAt: new Date() }
          : { status: ReminderJobStatus.FAILED, error: "email_failed" },
      });

      if (result.ok) {
        sent += 1;
        await writeAuditLog({
          organizationId: job.event.organizationId,
          action: "REMINDER_SENT",
          entityType: "EventReminderJob",
          entityId: job.id,
          metadata: { orderId: order.id, kind: job.kind },
        });
      }
    }

    return { processed: due.length, sent };
  }
}
