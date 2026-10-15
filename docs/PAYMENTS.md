# Payments — Ticketly

## Production default

**Nexi Checkout (Nets Easy)** is the primary production payment provider.

```
PAYMENT_PROVIDER=nexi
```

Architecture:

```
PaymentProvider
├── NexiCheckoutProvider   ← production default
├── StripePaymentProvider  ← optional / fallback
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

## Mock / production rule

- Mock requires explicit `PAYMENT_PROVIDER=mock` (or legacy `STRIPE_MOCK_MODE=true` in non-prod)
- **Never** silently fall back to mock when Nexi keys are missing in production
- Missing production config → `PAYMENT_CONFIG_ERROR` and checkout blocked

## Stripe (optional)

Keep Stripe keys only if you need Stripe as fallback. Launch checklist does
**not** require Stripe when `PAYMENT_PROVIDER=nexi`.

## Further reading

- [NEXI_CHECKOUT.md](./NEXI_CHECKOUT.md) — keys, webhooks, sandbox, debugging
- [MOBILE_PAYMENTS.md](./MOBILE_PAYMENTS.md) — Expo path (may be partial for web launch)
- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)
- [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)
