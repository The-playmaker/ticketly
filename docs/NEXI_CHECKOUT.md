# Nexi Checkout / Nets Easy

Official Payment API (server-side REST). Do not put the secret API key in browser
or mobile clients. The **checkout key** is the only client-safe identifier.

## Environments

| | Test | Production |
|---|---|---|
| `NEXI_ENVIRONMENT` | `test` | `production` |
| Payment API | `https://test.api.dibspayment.eu` | `https://api.dibspayment.eu` |
| Checkout.js | `https://test.checkout.dibspayment.eu/v1/checkout.js?v=1` | `https://checkout.dibspayment.eu/v1/checkout.js?v=1` |

Preview/staging on Vercel should use **test**. Production should use **production**.

## Required keys

| Variable | Where | Notes |
|----------|--------|------|
| `NEXI_SECRET_API_KEY` | Server only | Portal → Integration keys |
| `NEXI_CHECKOUT_KEY` | Server (+ optional `NEXT_PUBLIC_…`) | Client-safe checkout key |
| `NEXI_WEBHOOK_SECRET` | Server | 8–64 chars; we set this as webhook `authorization` |
| `NEXI_ENVIRONMENT` | Server | `test` \| `production` |
| `NEXI_MERCHANT_ID` | Optional | Merchant number when required by agreement |
| `APP_URL` | Server | Public HTTPS origin (webhook + embedded checkout URL) |
| `PAYMENT_PROVIDER` | Server | `nexi` |

Never commit real secrets.

## Webhook configuration

Webhook URL (per payment, subscribed at create):

```
POST {APP_URL}/api/payments/nexi/webhook
```

Nexi sends `Authorization: <NEXI_WEBHOOK_SECRET>`.
We acknowledge with **HTTP 200** only (Nexi treats other 2xx as failure).

Events we subscribe:

- `payment.checkout.completed`
- `payment.reservation.created.v2`
- `payment.reservation.failed`
- `payment.charge.created.v2`
- `payment.charge.failed.v2`
- `payment.cancel.created`
- `payment.refund.initiated.v2`
- `payment.refund.completed`
- `payment.refund.failed`

Idempotency: unique `(provider, eventId)`. Duplicates return 200 without re-issuing tickets.

## Payment lifecycle

1. Ticketly creates order + price snapshot (server)
2. `POST /v1/payments` with `EmbeddedCheckout`, `charge: true`, order items in øre
3. Customer pays inside Ticketly checkout via Checkout.js
4. Webhook → verify amount/currency/order → `PAID` → issue tickets once
5. Confirmation email is best-effort (failure does not roll back payment)

## Payment methods (Norway)

Methods come from what is **activated on the Nexi merchant account**.
Priority when enabled: Vipps → Visa/Mastercard → Apple Pay → Google Pay.

Vipps through Nexi is stored as:

- `provider = NEXI`
- `paymentMethod = VIPPS`
- `paymentType = WALLET`

Do not show Vipps in custom UI unless the merchant has it enabled — prefer letting
Checkout present available methods.

## Refunds

`POST /v1/charges/{chargeId}/refunds` with amount in øre.
Store `providerRefundId`. Partial refunds may require `orderItems`.

## Cancellation

`POST /v1/payments/{paymentId}/cancels` for authorized-but-not-captured payments.
Not modeled as a refund.

## Embedded checkout

Page: `/checkout/payment?paymentId=…`

- Ticketly: contact, order summary, reservation countdown, seller, terms
- Nexi: sensitive payment UI (cards / Vipps / wallets)

`checkout.url` must match this page URL exactly (scheme + host + path).

## Debugging

- Admin → Webhooks: event, payment ID, order, received, processed, status, error
- Safe replay re-runs **our** processing only (idempotent)
- Payment health: `GET /api/admin/payments/health` (config status, no heavy API calls)
- Never log secret keys, full card data, or full QR tokens

## Sandbox test flow (required before production)

1. Create a real Ticketly test event
2. Create 1 ticket type / release inventory
3. Open public checkout
4. Pay with Nexi **test** method (test card / test Vipps as applicable)
5. Confirm webhook received (`payment.checkout.completed` / charge)
6. Order → PAID, ticket generated, QR visible
7. Admin sale count updates
8. Admin refund → ticket `REFUNDED`
9. Scanner rejects refunded ticket

## Launch verification

See [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md). Code + build is not enough —
a real Nexi test transaction through the full path above is required.
