-- AlterEnum PaymentStatus
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

-- AlterEnum PaymentProviderType
ALTER TYPE "PaymentProviderType" ADD VALUE IF NOT EXISTS 'NEXI';
ALTER TYPE "PaymentProviderType" ADD VALUE IF NOT EXISTS 'MOCK';

-- CreateEnum WebhookProcessStatus
DO $$ BEGIN
  CREATE TYPE "WebhookProcessStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'SKIPPED', 'DUPLICATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable Payment
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerChargeId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paymentType" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerStatus" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerMetadata" JSONB;

CREATE INDEX IF NOT EXISTS "Payment_providerChargeId_idx" ON "Payment"("providerChargeId");

-- AlterTable WebhookEvent
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "paymentId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "status" "WebhookProcessStatus" NOT NULL DEFAULT 'RECEIVED';
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "WebhookEvent_paymentId_idx" ON "WebhookEvent"("paymentId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_status_idx" ON "WebhookEvent"("status");
CREATE INDEX IF NOT EXISTS "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateTable OrganizationPaymentConfiguration
CREATE TABLE IF NOT EXISTS "OrganizationPaymentConfiguration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "secretRef" TEXT,
    "checkoutKeyPublic" TEXT,
    "merchantId" TEXT,
    "environment" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationPaymentConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationPaymentConfiguration_organizationId_provider_key"
  ON "OrganizationPaymentConfiguration"("organizationId", "provider");
CREATE INDEX IF NOT EXISTS "OrganizationPaymentConfiguration_organizationId_isActive_idx"
  ON "OrganizationPaymentConfiguration"("organizationId", "isActive");

DO $$ BEGIN
  ALTER TABLE "OrganizationPaymentConfiguration"
    ADD CONSTRAINT "OrganizationPaymentConfiguration_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
