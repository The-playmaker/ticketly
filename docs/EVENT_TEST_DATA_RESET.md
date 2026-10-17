# SUPER_ADMIN test event reset

Clears **sales/test data for a single event** before launch without recreating the event or touching other orgs/events.

## UI

- **Sikkerhet** (`/admin/events/[id]/security`) — «Nullstill testdata»
- **Innstillinger** (`/admin/events/[id]/settings`) — same control (SUPER_ADMIN only)

Flow: dry-run preview → type `RESET TEST EVENT` → execute → summary of deleted / remaining counts.

## API

`POST /api/admin/events/[id]/test-reset`

```json
{ "dryRun": true }
```

```json
{
  "dryRun": false,
  "confirmation": "RESET TEST EVENT",
  "allowProductionOverride": false,
  "productionConfirmation": "I UNDERSTAND THIS IS PRODUCTION"
}
```

Auth: **SUPER_ADMIN only** (`requireSuperAdmin`). Others get 403.

## Safety gates

1. **Role** — non–SUPER_ADMIN → 403.
2. **Confirmation** — execute requires exact string `RESET TEST EVENT`.
3. **Production gate** — execute is blocked (409 `PRODUCTION_EVENT_RESET_BLOCKED`) when either:
   - the event has **paid** orders whose `customerEmail` is **not** a known test marker (`@example.com`, `@test.local`, `@ticketly.test`, or local-part prefixes `test+` / `demo+` / `seed+`), **or**
   - event status is treated as **live** (`PUBLISHED` | `PAUSED` | `SOLD_OUT` — schema has no `LIVE`) **and** paid revenue &gt; 0.
4. **Override** — only when **all** of:
   - `ALLOW_PRODUCTION_EVENT_RESET=true` in the environment
   - body `allowProductionOverride: true`
   - body `productionConfirmation: "I UNDERSTAND THIS IS PRODUCTION"`

Dry-run is always allowed for SUPER_ADMIN (shows inventory + whether the gate would block).

## Deleted (this event only)

Orders and dependents: payments, refunds, order items, order snapshots, tickets, transfers, wallet passes, reservations, check-ins (online + offline), webhook rows tied to those orders, notification logs for the event/orders, analytics events for the event.

`TicketType.quantitySold` and `quantityReserved` reset to **0**.

## Preserved

- The `Event` row and config (status, capacity, fees, policies, QR mode, waitlist flags, …)
- `TicketType.quantityTotal`, `quantityReleased`, `price`, and other type config
- Other events and organizations
- Promo codes / guest list / waitlist / scanner devices (not sales counters)

## Audit

Successful execute writes `EVENT_TEST_DATA_RESET` with actor, organization, and before/after counts.
