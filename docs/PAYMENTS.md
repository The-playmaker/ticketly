# Payments — Ticketly

## Production target

**Nets Easy (Nexi Checkout)** is the **primary** payment provider.
**Stripe Checkout Form** (`ui_mode=form`) is the **create-time backup**.

```
PAYMENT_PROVIDER=nexi
PAYMENT_BACKUP_PROVIDER=stripe
# alias: PAYMENT_STRIPE_BACKUP=true
```

Architecture:

```
PaymentProvider
├── NexiCheckoutProvider   ← primary (Nets Easy)
├── StripePaymentProvider  ← backup (before payment creation only)
└── MockPaymentProvider    ← local only (PAYMENT_PROVIDER=mock)
```

All provider-specific HTTP, webhook parsing, and status mapping live under
`apps/web/src/lib/payments/`. Order / checkout / ticket services call the
abstraction only. Each checkout attempt persists its own `Payment` row with
the provider actually used (including failover metadata).

## Failover rules (strict)

Use Stripe **only** when Nets Easy is **definitively unavailable before** a
payment object is created:

| Situation | Failover? |
|-----------|-----------|
| Missing / placeholder Nexi keys, config assert failure | Yes (if backup configured) |
| Nexi API 401 / 403 | Yes |
| Network timeout / unreachable (status 0) | **No** (unknown) |
| Nexi 5xx / 429 | **No** (unknown) |
| Validation 4xx (amount/items) | **No** |
| Pending / open checkout already exists | **No** — reuse or wait |
| After Payment row created / mid-payment | **Never** |

Before any new attempt: check original provider status. If already charged →
`markOrderPaid` (never create a second charge path). Open sessions are reused.
Expired/cancelled attempts allow a new independent attempt (new idempotency key).

## Auth / capture strategy

For normal event tickets we use **immediate capture**:

- Create payment with `checkout.charge: true`
- Nexi reserves (authorizes) then charges in the same customer flow
- Ticketly marks the order **PAID** on `payment.checkout.completed` /
  `payment.charge.created.v2` after amount/currency verification
- Tickets are issued exactly once after PAID

We do **not** use shipping-based authorize-then-capture for event tickets.
Cancellation of an uncaptured reservation (if charge were false) is modeled as
**provider cancel**, not a refund — see audit action `PAYMENT_CANCELLED`.

**Never downgrade PAID** (or PARTIALLY_REFUNDED / REFUNDED) when a delayed
failure/cancel webhook arrives.

## Money

- Internal amounts: integer **øre** (minor units). Example: 438 NOK = `43800`
- NOK is the default and required currency for Nexi ticket sales
- Never accept client-supplied price / tax / total as source of truth

## Success URL is not proof

`/orders/{orderNumber}?checkout=success` only means the browser returned.
Source of truth: verified provider state + webhook. The success page polls
order status until PAID or timeout.

## Refunds

- Always via the **original** payment’s provider (`Payment.provider`)
- Full order, single-ticket, or partial monetary refunds
- Local refund stays `PENDING` until the provider accepts the operation;
  ticket state updates after provider acceptance
- Double-refund and over-refund are blocked against paid/captured amount
- `Refund.providerRefundId` is **unique** when set — webhook retries must not
  insert a second SUCCEEDED row for the same provider refund

## Event financial reporting (dashboard)

Per-event / org KPIs use explicit gross / refund / net — never “current PAID only”:

| Metric | Source |
|--------|--------|
| **Brutto salg** (`grossSales`) | Sum of `Order.total` for orders that reached paid (`paidAt` set **or** status in PAID / PARTIALLY_REFUNDED / REFUNDED). Fully refunded orders stay in gross history. |
| **Refundert beløp** (`successfulRefundAmount`) | Sum of `Refund.amount` where `status=SUCCEEDED` for the event/org. |
| **Netto omsetning** (`netRevenue`) | `grossSales − successfulRefundAmount`. Partial refunds reduce net by the refunded amount only. |
| **Solgt / aktive billetter** | Tickets in VALID / CHECKED_IN / TRANSFERRED (aligned with `TicketType.quantitySold`). |
| **Refunderte billetter** | Count of `Ticket.status=REFUNDED`. |

### `quantitySold` invariant

**Chosen:** `TicketType.quantitySold` = **current active sold inventory**.

- Incremented once on ticket fulfillment; **decremented on refund**.
- Inventory availability stays `released − sold − reserved`.
- Historical sales volume / brutto salg come from Orders + Refunds, not from `quantitySold`.

See also comments on `getReleasedAvailable` / `RefundService.refundOrder`.

## Mock / production rule

- Mock requires explicit `PAYMENT_PROVIDER=mock` (or legacy `STRIPE_MOCK_MODE=true` in non-prod)
- **Never** silently fall back to mock when Nexi keys are missing in production
- Missing production config → `PAYMENT_CONFIG_ERROR` and checkout blocked
  (unless create-time backup is configured **and** the failure is definitive)

## Required credentials

### Nets Easy (primary)

| Variable | Notes |
|----------|------|
| `PAYMENT_PROVIDER=nexi` | Primary |
| `NEXI_ENVIRONMENT` | `test` \| `production` |
| `NEXI_SECRET_API_KEY` | Server only |
| `NEXI_CHECKOUT_KEY` | Client-safe |
| `NEXI_WEBHOOK_SECRET` | 8–64 alphanumeric (official Authorization header) |
| `NEXI_MERCHANT_ID` | Optional |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | Public HTTPS origin |

Webhook: `{APP_URL}/api/payments/nexi/webhook`

### Stripe (backup)

| Variable | Notes |
|----------|------|
| `PAYMENT_BACKUP_PROVIDER=stripe` | Or `PAYMENT_STRIPE_BACKUP=true` |
| `STRIPE_SECRET_KEY` | `sk_live_…` / `sk_test_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `STRIPE_MOCK_MODE=false` | Never true in production |

Webhook: `{APP_URL}/api/payments/stripe/webhook`

## Payment reconciliation

Both PSPs: successful payments always go through `PaymentService.markOrderPaid`
(exactly-once fulfillment). Reconciliation never creates tickets directly.

- CLI (dry-run default): `npm run payments:reconcile -- --since-hours 24`
- Provider filter: `--provider stripe` \| `nexi` \| `all` (default)
- Apply: `npm run payments:reconcile -- --apply --since-hours 24`
- Cron route: `GET/POST /api/cron/payments-reconcile` (`CRON_SECRET`); Vercel
  `crons` schedule omitted on Hobby — invoke externally (do **not** add Hobby
  crons to `vercel.json`)
- Admin UI (SUPER_ADMIN): `/admin/platform/payments/reconciliation` (Stripe UI);
  Nexi via CLI/cron; order detail shows all payment attempts + failover

Reservation inventory cleanup uses the same `CRON_SECRET` pattern — see
[RESERVATIONS.md](./RESERVATIONS.md).

## Further reading

- [NEXI_CHECKOUT.md](./NEXI_CHECKOUT.md) — keys, webhooks, sandbox
- [STRIPE_INTEGRATION_TODO.md](../STRIPE_INTEGRATION_TODO.md) — Checkout Form wiring
- [MOBILE_PAYMENTS.md](./MOBILE_PAYMENTS.md) — Expo path (may be partial for web launch)
- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)
- [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)
