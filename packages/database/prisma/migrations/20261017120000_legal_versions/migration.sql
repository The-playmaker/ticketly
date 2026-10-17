-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "privacyVersion" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "refundPolicyVersion" TEXT;
