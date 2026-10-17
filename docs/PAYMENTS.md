# Payments — Ticketly

## Production current

**Stripe Checkout Form** (`ui_mode=form`) is the **current** production payment provider.

```
PAYMENT_PROVIDER=stripe
```

Nexi Checkout remains available as a **future / optional** cutover target — not the live PSP today.

Architecture:

```
PaymentProvider
├── StripePaymentProvider  ← current production
├── NexiCheckoutProvider   ← future / optional
└── MockPaymentProvider    ← local only (PAYMENT_PROVIDER=mock)
```

All provider-specific HTTP, webhook parsing, and status mapping live under
`apps/web/src/lib/payments/`. Order / checkout / ticket services call the
abstraction only.

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

## Money

- Internal amounts: integer **øre** (minor units). Example: 438 NOK = `43800`
- NOK is the default and required currency for Nexi ticket sales
- Never accept client-supplied price / tax / total as source of truth

## Success URL is not proof

`/orders/{orderNumber}?checkout=success` only means the browser returned.
Source of truth: verified provider state + webhook. The success page polls
order status until PAID or timeout.

## Refunds

- Full order, single-ticket, or partial monetary refunds via Nexi
  `POST /v1/charges/{chargeId}/refunds`
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

## Stripe (current production)

Required for live sales: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_MOCK_MODE=false`, plus `APP_URL` /
`NEXT_PUBLIC_APP_URL` (production: `https://billett.xodrammen.no`).
Webhook: `{APP_URL}/api/payments/stripe/webhook`.

## Nexi (future / optional)

When cutting over later, set `PAYMENT_PROVIDER=nexi` with Nexi production keys.
Do **not** migrate historical Stripe payments.

## Further reading

- [STRIPE_INTEGRATION_TODO.md](../STRIPE_INTEGRATION_TODO.md) — Checkout Form wiring
- [NEXI_CHECKOUT.md](./NEXI_CHECKOUT.md) — keys, webhooks, sandbox (future)
- [MOBILE_PAYMENTS.md](./MOBILE_PAYMENTS.md) — Expo path (may be partial for web launch)
- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)
- [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)
