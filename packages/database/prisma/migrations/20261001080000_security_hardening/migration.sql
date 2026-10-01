-- Security hardening: access tokens, QR hashes, mobile sessions, purchasable flag

-- Order access token + payment anomaly
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "accessToken" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentAnomaly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentAnomalyReason" TEXT;

UPDATE "Order" SET "accessToken" = md5(random()::text || id || clock_timestamp()::text)
WHERE "accessToken" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "accessToken" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_accessToken_key" UNIQUE ("accessToken");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Order_accessToken_idx" ON "Order"("accessToken");

-- Ticket token hash / cipher; secureToken becomes nullable
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "tokenCipher" TEXT;

UPDATE "Ticket"
SET "tokenHash" = encode(sha256(convert_to(COALESCE("secureToken", id), 'UTF8')), 'hex')
WHERE "tokenHash" IS NULL;

ALTER TABLE "Ticket" ALTER COLUMN "tokenHash" SET NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "secureToken" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tokenHash_key" UNIQUE ("tokenHash");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Ticket_tokenHash_idx" ON "Ticket"("tokenHash");

-- Public purchasability
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "isPubliclyPurchasable" BOOLEAN NOT NULL DEFAULT true;

-- Mobile sessions
CREATE TABLE IF NOT EXISTS "MobileSession" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MobileSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MobileSession_jti_key" ON "MobileSession"("jti");
CREATE INDEX IF NOT EXISTS "MobileSession_userId_idx" ON "MobileSession"("userId");
CREATE INDEX IF NOT EXISTS "MobileSession_expiresAt_idx" ON "MobileSession"("expiresAt");
