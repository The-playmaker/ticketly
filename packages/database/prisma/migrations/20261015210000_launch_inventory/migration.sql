ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

DO $$ BEGIN
  CREATE TYPE "AvailabilityDisplayMode" AS ENUM ('SHOW_EXACT', 'SHOW_LOW_STOCK_ONLY', 'HIDE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SoldOutDisplayMode" AS ENUM ('SOLD_OUT', 'MORE_COMING', 'PAUSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AnalyticsEventType" AS ENUM (
    'PAGE_VIEW', 'TICKET_SELECTION', 'CHECKOUT_STARTED',
    'PAYMENT_INITIATED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'RESERVATION_EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "salesPausedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "availabilityDisplay" "AvailabilityDisplayMode" NOT NULL DEFAULT 'SHOW_LOW_STOCK_ONLY';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "soldOutDisplay" "SoldOutDisplayMode" NOT NULL DEFAULT 'SOLD_OUT';

ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "quantityReleased" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "salesPausedAt" TIMESTAMP(3);
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "releaseMode" TEXT NOT NULL DEFAULT 'MANUAL';

-- Backfill: previously all capacity was on sale
UPDATE "TicketType" SET "quantityReleased" = "quantityTotal" WHERE "quantityReleased" = 0 AND "quantityTotal" > 0;

ALTER TABLE "TicketReservation" ADD COLUMN IF NOT EXISTS "unitPriceSnapshot" INTEGER;
ALTER TABLE "TicketReservation" ADD COLUMN IF NOT EXISTS "serviceFeeSnapshot" INTEGER;
ALTER TABLE "TicketReservation" ADD COLUMN IF NOT EXISTS "lineTotalSnapshot" INTEGER;

CREATE TABLE IF NOT EXISTS "PriceHistory" (
  "id" TEXT NOT NULL,
  "ticketTypeId" TEXT NOT NULL,
  "oldPrice" INTEGER NOT NULL,
  "newPrice" INTEGER NOT NULL,
  "changedById" TEXT,
  "reason" TEXT,
  "ruleId" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PriceHistory_ticketTypeId_changedAt_idx" ON "PriceHistory"("ticketTypeId", "changedAt");
DO $$ BEGIN
  ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_ticketTypeId_fkey"
    FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TicketBatch" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "ticketTypeId" TEXT NOT NULL,
  "name" TEXT,
  "quantity" INTEGER NOT NULL,
  "price" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "releasedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "autoOpen" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TicketBatch_eventId_sortOrder_idx" ON "TicketBatch"("eventId", "sortOrder");
CREATE INDEX IF NOT EXISTS "TicketBatch_ticketTypeId_idx" ON "TicketBatch"("ticketTypeId");
DO $$ BEGIN
  ALTER TABLE "TicketBatch" ADD CONSTRAINT "TicketBatch_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "TicketBatch" ADD CONSTRAINT "TicketBatch_ticketTypeId_fkey"
    FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "WaitlistEntry" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notifiedAt" TIMESTAMP(3),
  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WaitlistEntry_eventId_createdAt_idx" ON "WaitlistEntry"("eventId", "createdAt");
CREATE INDEX IF NOT EXISTS "WaitlistEntry_email_idx" ON "WaitlistEntry"("email");
DO $$ BEGIN
  ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT,
  "organizationId" TEXT,
  "type" "AnalyticsEventType" NOT NULL,
  "sessionId" TEXT,
  "orderId" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "utmTerm" TEXT,
  "referrer" TEXT,
  "path" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_eventId_type_createdAt_idx" ON "AnalyticsEvent"("eventId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_organizationId_createdAt_idx" ON "AnalyticsEvent"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent"("sessionId");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");
DO $$ BEGIN
  ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
