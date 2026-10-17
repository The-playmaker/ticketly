-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "AuthActionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthActionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthActionToken_tokenHash_key" ON "AuthActionToken"("tokenHash");
CREATE INDEX "AuthActionToken_email_purpose_idx" ON "AuthActionToken"("email", "purpose");
CREATE INDEX "AuthActionToken_expiresAt_idx" ON "AuthActionToken"("expiresAt");

-- Alter OrganizationInvitation: add new columns, migrate token → tokenHash if present
ALTER TABLE "OrganizationInvitation" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;
ALTER TABLE "OrganizationInvitation" ADD COLUMN IF NOT EXISTS "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "OrganizationInvitation" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);

-- Backfill tokenHash from legacy token column when empty
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'OrganizationInvitation' AND column_name = 'token'
  ) THEN
    UPDATE "OrganizationInvitation" SET "tokenHash" = "token" WHERE "tokenHash" IS NULL;
  END IF;
END $$;

-- Ensure tokenHash uniqueness
UPDATE "OrganizationInvitation" SET "tokenHash" = 'legacy_' || "id" WHERE "tokenHash" IS NULL;
ALTER TABLE "OrganizationInvitation" ALTER COLUMN "tokenHash" SET NOT NULL;

DROP INDEX IF EXISTS "OrganizationInvitation_token_key";
ALTER TABLE "OrganizationInvitation" DROP COLUMN IF EXISTS "token";

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationInvitation_tokenHash_key" ON "OrganizationInvitation"("tokenHash");
CREATE INDEX IF NOT EXISTS "OrganizationInvitation_status_expiresAt_idx" ON "OrganizationInvitation"("status", "expiresAt");
