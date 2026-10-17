-- Exactly-once ticket fulfillment marker on Order.
-- Issuance must SELECT … FOR UPDATE this row, re-check tickets / ticketsFulfilledAt,
-- then create tickets and set ticketsFulfilledAt in the SAME transaction.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ticketsFulfilledAt" TIMESTAMP(3);

-- Backfill for already-issued orders (do not delete or modify Ticket rows).
UPDATE "Order" o
SET "ticketsFulfilledAt" = COALESCE(
  o."paidAt",
  (SELECT MIN(t."createdAt") FROM "Ticket" t WHERE t."orderId" = o.id),
  o."createdAt"
)
WHERE o."ticketsFulfilledAt" IS NULL
  AND EXISTS (SELECT 1 FROM "Ticket" t WHERE t."orderId" = o.id);

CREATE INDEX IF NOT EXISTS "Order_ticketsFulfilledAt_idx" ON "Order" ("ticketsFulfilledAt");
