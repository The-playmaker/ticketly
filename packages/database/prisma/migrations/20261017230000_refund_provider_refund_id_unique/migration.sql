-- Idempotent refund identity: webhook retries / duplicate provider ids must not
-- create a second Refund row that would double-count successfulRefundAmount.
CREATE UNIQUE INDEX IF NOT EXISTS "Refund_providerRefundId_key" ON "Refund"("providerRefundId");
