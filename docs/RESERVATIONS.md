# Reservation inventory

Ticket holds (`TicketReservation`) temporarily decrement available inventory via
`TicketType.quantityReserved`. Abandoned checkouts and missed expire paths can
leave counters high and block sales even when no real hold remains.

## Invariant

```
quantityReserved = SUM(quantity)
  WHERE status = ACTIVE
  AND reservation should still hold inventory
    (expiresAt > now, OR payment-grace PENDING, OR PAID awaiting fulfillment)
```

Before public/admin inventory is returned for sales decisions, Ticketly:

1. Expires stale `ACTIVE` reservations (respecting payment grace / PAID holds)
2. Rebuilds `quantityReserved` from DB truth when a mismatch is detected

Opportunistic cleanup is throttled on the no-op path; **drift always forces a repair**.

## Tools

| Tool | Purpose |
|------|---------|
| `POST/GET /api/cron/reservations-cleanup` | Scheduled / manual batch cleanup (`CRON_SECRET`) |
| `npm run reservations:repair -- --event <id>` | Dry-run emergency CLI |
| `npm run reservations:repair -- --event <id> --apply` | Apply emergency CLI |
| Admin settings → «Reparere reservasjoner» | SUPER_ADMIN UI dry-run + apply |
| Event ops / settings drift banner | Organizer warning when counters diverged |

## External scheduler (recommended)

Do **not** add a frequent schedule to `vercel.json` on the Vercel Hobby plan
(Hobby forbids cron schedules). Call the protected endpoint from an external
scheduler (GitHub Actions, cron-job.org, systemd timer, etc.):

```bash
# Batch: expire stale ACTIVE + rebuild counters for drifted events
curl -X POST "https://billett.xodrammen.no/api/cron/reservations-cleanup" \
  -H "Authorization: Bearer $CRON_SECRET"

# Single event
curl -X POST "https://billett.xodrammen.no/api/cron/reservations-cleanup?event=<eventId>" \
  -H "Authorization: Bearer $CRON_SECRET"

# Dry-run one event
curl "https://billett.xodrammen.no/api/cron/reservations-cleanup?event=<eventId>&dryRun=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Set `CRON_SECRET` in the Vercel project env (same secret used by payments reconcile).
Suggested cadence: every 5–15 minutes.

Optional query params:

- `event=<id>` — repair one event
- `dryRun=1` — preview only (requires `event`)
- `limit=50` — max events in a batch (capped at 100)

## Related

- [PAYMENTS.md](./PAYMENTS.md) — payment grace / webhook race
- [TICKET_FULFILLMENT.md](./TICKET_FULFILLMENT.md) — PAID holds until tickets issue
