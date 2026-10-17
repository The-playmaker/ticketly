# Ticket fulfillment — exactly-once

## Root cause (fixed)

Stripe can deliver both `checkout.session.completed` and `payment_intent.succeeded` for the same payment. Each event has a **different** Stripe event id, so webhook event-id idempotency alone does not serialize fulfillment.

Previously `markOrderPaid` committed payment state, then called `issueTicketsForPaidOrder`, which **read** ticket count outside a lock and only then opened a create transaction. Two workers could both observe zero tickets and both issue.

## Fix

1. **`SELECT … FOR UPDATE` on `Order`** inside the **same** transaction that re-queries tickets / `ticketsFulfilledAt` and creates rows.
2. After lock: if `ticketsFulfilledAt` is set **or** any tickets exist → return existing, create nothing, send **no** automatic emails.
3. Else issue `sum(quantity × admissionCount)` tickets, increment `quantitySold` once, convert reservation once, set `ticketsFulfilledAt`.
4. Automatic order/ticket emails run only when this call is the issuer (`newlyIssued`).

**DB invariant choice:** nullable `Order.ticketsFulfilledAt` set atomically with ticket inserts under the Order row lock. This is a fulfillment marker (not a unique ticket constraint). Row-level lock + re-check is the concurrency control; the timestamp makes “already fulfilled” explicit for ops/diagnostics and prevents re-entry even if tickets were manually removed incorrectly.

Do **not** rely solely on Stripe `event.id` uniqueness for ticket issuance.

## Expected ticket count

```
expected = Σ (OrderItem.quantity × TicketType.admissionCount)
```

Bundles: one sale unit may yield multiple QR tickets via `admissionCount` / `isBundle`. Confirm values on the TicketType before treating a surplus as a race duplicate.

## Admin / remediation

- Admin order detail shows issued vs expected and per-line `isBundle` / `admissionCount` when mismatched.
- Script (dry-run by default):

```bash
npx tsx --env-file-if-exists=.env scripts/report-ticket-fulfillment-mismatches.ts
npx tsx --env-file-if-exists=.env scripts/report-ticket-fulfillment-mismatches.ts --order TKT-2026-000010
npx tsx --env-file-if-exists=.env scripts/report-ticket-fulfillment-mismatches.ts --mark-fulfilled
```

### Manual remediation for TKT-2026-000010 (race duplicate)

Do **not** silently delete production tickets.

1. Dry-run the script for `TKT-2026-000010`. Confirm `quantity`, `isBundle`, `admissionCount`, expected vs actual, and both public ids (`TKT-WXV6CT`, `TKT-SBAVJU`).
2. If `isBundle=false` and `admissionCount=1` with `expected=1` `actual=2`: webhook race, not a bundle.
3. Check `checkedInAt` / status on both tickets.
4. Prefer keeping the earlier ticket; set the unused duplicate to `CANCELLED` (not DELETE). If `quantitySold` was double-incremented, decrement by 1 in a controlled admin action and write an audit note.
5. If either ticket was scanned or the customer already used both codes, use refund/support process — do not auto-void.
6. Ensure `ticketsFulfilledAt` is set (`--mark-fulfilled` or deploy backfill migration).

## Tests

`apps/web/tests/integration/ticket-fulfillment-race.test.ts` — two simultaneous `markOrderPaid` / `issueTicketsForPaidOrder` against real PostgreSQL for qty=1 and qty=2.
