# SUPER_ADMIN event test-data reset

Clears **local operational/test data for a single event** before launch without recreating the event or touching other orgs/events. **Does not issue refunds.** Stripe remains the financial source of record.

## UI

- **Sikkerhet** (`/admin/events/[id]/security`) — «Nullstill testdata»
- **Innstillinger** (`/admin/events/[id]/settings`) — same control (SUPER_ADMIN only)

Copy shown to the operator:

> Dette sletter lokale testordre, billetter, refusjoner, reservasjoner og analyse for dette arrangementet. Stripe-historikk påvirkes ikke.

Flow: dry-run preview → type exact `RESET TEST EVENT` → execute → summary of deleted / remaining counts.

## API (preferred)

`GET /api/admin/events/[id]/reset-test-data` — dry-run inventory + safety gate

`POST /api/admin/events/[id]/reset-test-data`

```json
{ "confirm": "RESET TEST EVENT" }
```

Auth: **SUPER_ADMIN only** (`requireSuperAdmin`). Organizers and other roles get 403.

Legacy alias (same service): `GET|POST /api/admin/events/[id]/test-reset`  
Legacy POST still accepts `{ "dryRun": true }` and `{ "dryRun": false, "confirmation": "RESET TEST EVENT" }`.

## Safety gates

1. **Role** — non–SUPER_ADMIN → 403.
2. **Confirmation** — execute requires exact string `RESET TEST EVENT`.
3. **Fully refunded only (primary)** — execute is blocked (409 `EVENT_RESET_BLOCKED_UNREFUNDED`) when the event has any order with payment status:
   - `PAID`
   - `PARTIALLY_REFUNDED`
   - `REVIEW_REQUIRED`
   - `AUTHORIZED`
   - or otherwise financially unsettled

   Fully `REFUNDED` orders (and non-financial `PENDING` / `FAILED` / `CANCELLED`) are allowed. **Reset never calls Stripe refund APIs.**

4. **Emergency override (optional, off by default)** — only when **all** of:
   - `ALLOW_PRODUCTION_EVENT_RESET=true` in the environment
   - body `allowEmergencyOverride: true`
   - body `emergencyConfirmation: "I UNDERSTAND THIS IS PRODUCTION"`

   This bypasses the refunded-only gate for true emergencies. Default path must always be refunded-only. Never enable casually in production.

Dry-run is always allowed for SUPER_ADMIN (shows inventory + whether the gate would block).

## Scope — deleted (this event only)

Orders and dependents: payments, refunds, order items, order snapshots, tickets, transfers, wallet passes, reservations, check-ins (online + offline), webhook rows tied to those orders, notification logs for the event/orders, analytics events, waitlist entries, reminder jobs, and promo `usedCount` decrements attributable to deleted orders.

`TicketType.quantitySold` and `quantityReserved` reset to **0**.

## Preserved

- The `Event` row and config (status, capacity, slug, cover, fees, policies, QR mode, waitlist flags, age, venue, …)
- `TicketType.quantityTotal`, `quantityReleased`, `price`, min/max, visibility, salesPaused
- Other events and organizations / seller org
- Scanner devices, guest list entries, promo code definitions (not usage counters)
- Stripe payment/refund history externally

## Audit

Successful execute writes `EVENT_TEST_DATA_RESET` with `eventId`, `actorId`, counts deleted, ticket type counters before/after, and timestamp.
