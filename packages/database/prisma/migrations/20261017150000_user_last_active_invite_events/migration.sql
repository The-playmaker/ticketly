-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User"("isActive");

-- AlterTable
ALTER TABLE "OrganizationInvitation" ADD COLUMN IF NOT EXISTS "restrictedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
