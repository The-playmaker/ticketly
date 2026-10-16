-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'INVITED', 'CLAIMED', 'EXPIRED', 'REMOVED');
CREATE TYPE "ReminderKind" AS ENUM ('EVENT_24H', 'EVENT_3H', 'EVENT_CHANGED', 'EVENT_CANCELLED');
CREATE TYPE "ReminderJobStatus" AS ENUM ('SCHEDULED', 'SENT', 'FAILED', 'CANCELLED', 'SKIPPED');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- EventSeries
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "venueId" TEXT,
    "coverImageUrl" TEXT,
    "ageLimit" INTEGER,
    "defaults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventSeries_organizationId_idx" ON "EventSeries"("organizationId");
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Event columns
ALTER TABLE "Event" ADD COLUMN "waitlistEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "waitlistOnReleaseSoldOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "reminder24hEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Event" ADD COLUMN "reminder3hEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "seriesId" TEXT;
CREATE INDEX "Event_seriesId_idx" ON "Event"("seriesId");
ALTER TABLE "Event" ADD CONSTRAINT "Event_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TicketType bundle
ALTER TABLE "TicketType" ADD COLUMN "admissionCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TicketType" ADD COLUMN "isBundle" BOOLEAN NOT NULL DEFAULT false;

-- Waitlist expansion
ALTER TABLE "WaitlistEntry" ADD COLUMN "ticketTypeId" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN "phone" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN "requestedQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WaitlistEntry" ADD COLUMN "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING';
ALTER TABLE "WaitlistEntry" ADD COLUMN "inviteToken" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "WaitlistEntry" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "WaitlistEntry" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "WaitlistEntry" SET "requestedQuantity" = "quantity" WHERE "requestedQuantity" = 1 AND "quantity" <> 1;
CREATE UNIQUE INDEX "WaitlistEntry_inviteToken_key" ON "WaitlistEntry"("inviteToken");
CREATE INDEX "WaitlistEntry_eventId_status_createdAt_idx" ON "WaitlistEntry"("eventId", "status", "createdAt");
CREATE INDEX "WaitlistEntry_eventId_email_idx" ON "WaitlistEntry"("eventId", "email");
CREATE INDEX "WaitlistEntry_ticketTypeId_status_idx" ON "WaitlistEntry"("ticketTypeId", "status");
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reminder jobs
CREATE TABLE "EventReminderJob" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReminderJobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventReminderJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventReminderJob_eventId_orderId_kind_key" ON "EventReminderJob"("eventId", "orderId", "kind");
CREATE INDEX "EventReminderJob_status_scheduledFor_idx" ON "EventReminderJob"("status", "scheduledFor");
CREATE INDEX "EventReminderJob_eventId_kind_idx" ON "EventReminderJob"("eventId", "kind");
ALTER TABLE "EventReminderJob" ADD CONSTRAINT "EventReminderJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NotificationLog expansion
ALTER TABLE "NotificationLog" ADD COLUMN "orderId" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN "eventId" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'SENT';
ALTER TABLE "NotificationLog" ADD COLUMN "error" TEXT;
CREATE INDEX "NotificationLog_orderId_sentAt_idx" ON "NotificationLog"("orderId", "sentAt");
CREATE INDEX "NotificationLog_eventId_sentAt_idx" ON "NotificationLog"("eventId", "sentAt");
CREATE INDEX "NotificationLog_status_sentAt_idx" ON "NotificationLog"("status", "sentAt");
