# Load testing

Profile: [`load/k6-smoke.js`](../load/k6-smoke.js)

## Goals

Measure before optimizing:

- Response time (p95)
- Failure rate under concurrent visitors
- Database / locking behavior during reservation bursts
- Scanner endpoint availability with multiple devices

## Run locally

```bash
# terminal 1
npm run dev:web

# terminal 2
k6 run -e BASE_URL=http://localhost:3456 load/k6-smoke.js
```

## Interpreted scenarios

| Stage | Intent |
|-------|--------|
| 500 ramped VUs browsing `/events/friday-night` | CDN/app SSR pressure |
| 100 VUs health/reserve probe | Connection pool stress |
| 20 VUs checkout-adjacent | Payment path readiness |
| 10 scanner probes | Door-time availability |

Full reservation/checkout load requires injecting seeded `eventId` / `ticketTypeId` and accepting controlled sold-out rates. Extend the script with those IDs from seed output when measuring inventory locking specifically — integration tests already cover correctness of races with real DB transactions.

## Bottlenecks to watch

- Prisma connection pool exhaustion
- `TicketType` row locks under reserve
- Next.js SSR for event pages
- Webhook processing lag (not in k6 smoke)

Document observed p95 / error rate in the PR or ops runbook after each staging load run.
