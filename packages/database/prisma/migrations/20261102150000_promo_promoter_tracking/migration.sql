-- Promoter / tracking extensions on PromoCode
CREATE TYPE "PromoCodeKind" AS ENUM ('DISCOUNT', 'TRACKING');

ALTER TABLE "PromoCode" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "PromoCode" ADD COLUMN IF NOT EXISTS "kind" "PromoCodeKind" NOT NULL DEFAULT 'DISCOUNT';

CREATE INDEX IF NOT EXISTS "PromoCode_kind_idx" ON "PromoCode"("kind");
