-- AlterTable Order — privacy-conscious UTM attribution
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "utmContent" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "utmTerm" TEXT;
