-- Additive: track idempotent promo usedCount release on PENDING expire/fail/cancel
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "promoReleasedAt" TIMESTAMP(3);
