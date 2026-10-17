# Stripe Checkout Studio — Ticketly integration

**Scenario:** A (existing `stripe.checkout.sessions.create` in Ticketly payment provider)

Embedded Checkout Form (`ui_mode: "form"`) wired into the existing order → webhook fulfillment flow. Nexi remains the primary production PSP; Stripe is the optional/fallback provider when `PAYMENT_PROVIDER=stripe`.

## Values to Replace

No Studio placeholders remain in create-session params. Configure real keys in env (never commit secrets):

| Placeholder / unset | Replace with |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_…` / `sk_live_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (`pk_test_…` / `pk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_…`) for `/api/payments/stripe/webhook` |

See [.env.example](.env.example).

## Configured Parameters (fixed_by_ui)

Applied in [`apps/web/src/lib/payments/stripe-provider.ts`](apps/web/src/lib/payments/stripe-provider.ts):

| Parameter | Value |
| --- | --- |
| `ui_mode` | `"form"` |
| `billing_address_collection` | `"auto"` |
| `phone_number_collection` | `{ enabled: false }` |
| `automatic_tax` | `{ enabled: false }` |
| `submit_type` | `"auto"` |
| `name_collection` | `{ individual: { enabled: true } }` |
| `integration_identifier` | `"custom_embedded_web_0001"` |

**sample_only (preserved):**

| Parameter | Ticketly value |
| --- | --- |
| `mode` | `"payment"` (one-time tickets) |
| `line_items` | Dynamic `price_data` from order total / description |

**Rule 8:** `payment_method_collection` is **not** set — it applies only when `mode` is `"subscription"`.

### Project-specific parameters retained

Required for Ticketly fulfillment / webhooks (outside Studio field list):

| Parameter | Why retained |
| --- | --- |
| `customer_email` | Prefill from Ticketly contact step |
| `return_url` | Maps from existing `successUrl` (order confirmation + access token); form UI replaces hosted `success_url` / `cancel_url` |
| `metadata.orderId` / `orderNumber` / `eventId` | Webhook → order lookup |
| `payment_intent_data.metadata` | PI-level fulfillment correlation |
| Idempotency key `checkout_${orderId}` | Safe retries |

## Files changed

| Area | Path |
| --- | --- |
| Session create (Part 1) | [apps/web/src/lib/payments/stripe-provider.ts](apps/web/src/lib/payments/stripe-provider.ts) |
| Result type | [apps/web/src/lib/payments/types.ts](apps/web/src/lib/payments/types.ts) |
| Checkout API (`client_secret`) | [apps/web/src/app/api/checkout/route.ts](apps/web/src/app/api/checkout/route.ts) |
| Payment page (Stripe branch) | [apps/web/src/app/checkout/payment/page.tsx](apps/web/src/app/checkout/payment/page.tsx) |
| Embedded form mount (Part 2) | [apps/web/src/components/checkout/stripe-embedded-checkout.tsx](apps/web/src/components/checkout/stripe-embedded-checkout.tsx) |
| Checkout chrome | [apps/web/src/components/checkout/stripe-checkout-container.tsx](apps/web/src/components/checkout/stripe-checkout-container.tsx) |
| CSP (Stripe.js) | [apps/web/next.config.ts](apps/web/next.config.ts) |

Contact form → pay still uses [apps/web/src/components/checkout/checkout-form.tsx](apps/web/src/components/checkout/checkout-form.tsx) (routes to `/checkout/payment` when `checkoutKey` is present).

## Setup and next steps

1. **Env** — Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MOCK_MODE=false`, `APP_URL`.
2. **API version** — Node SDK uses `2026-08-26.dahlia` (≥ `2026-03-25.dahlia`) for `ui_mode: "form"`.
3. **Client** — Stripe.js loaded from `https://js.stripe.com/dahlia/stripe.js` (never bundled). Appearance: `theme: "night"`. Form: `createForm({ layout: "expanded" })` → `#checkout-form` + confirm wiring.
4. **Flow** — Reservation → `/api/checkout` creates order + Checkout Session → `{ client_secret }` / payment page retrieves secret by session id → embedded form → `return_url` order page → webhook `checkout.session.completed` fulfills tickets.
5. **Webhook** — Endpoint: `{APP_URL}/api/payments/stripe/webhook`. Prefer Checkout Studio / Dashboard events for session completion.
6. **Test cards** — `4242 4242 4242 4242` (success), `4000 0025 0000 3155` (3DS), `4000 0000 0000 9995` (decline).
7. **Docs** — [Stripe Checkout Form quickstart](https://docs.stripe.com/checkout/form/quickstart), [Checkout Studio](https://dashboard.stripe.com/checkout/studio).

## Mock mode

`STRIPE_MOCK_MODE=true` still uses [apps/web/src/lib/payments/mock-stripe-provider.ts](apps/web/src/lib/payments/mock-stripe-provider.ts) (hosted mock redirect). Real embedded form requires live/test Stripe keys.
