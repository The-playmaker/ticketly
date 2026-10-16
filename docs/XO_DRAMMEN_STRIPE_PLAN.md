# Stripe integration plan — Xo Drammen × Ticketly

**Business:** [xodrammen.no](https://xodrammen.no) — bar / nightclub, age 18–24 (Drammen, Norway)  
**Products requested:** Payments · Invoicing · Terminal  
**Stack:** Ticketly (`PAYMENT_PROVIDER` + `PaymentProvider` abstraction)  
**Primary long-term target remains Nexi**; Stripe is the live fallback / temporary primary.

> Generated without `stripe_implementation_planner` (Stripe MCP not authenticated in this Cloud Agent session). Based on Stripe agent skills (`stripe-best-practices`) + Ticketly code review.

---

## 1. Recommended architecture

| Need | Stripe product / API | Ticketly mapping |
|------|----------------------|------------------|
| Online ticket sales | **Checkout Sessions** (hosted) | Existing `StripePaymentProvider.createCheckout` |
| Door / bar card present | **Terminal** + PaymentIntents (`card_present`) | **Not built** — new flow |
| Corporate / table / group invoices | **Invoicing** | **Not built** — optional B2B path |
| Refunds / partial refunds | Refunds API on stored PaymentIntent | Existing `RefundService` + provider-from-Payment |
| Fulfillment | Webhooks (required) | `POST /api/payments/stripe/webhook` |

**Do not** use Charges API, Sources, Tokens, or Card Element.

**Dynamic payment methods:** omit `payment_method_types` on Checkout (already the case). Configure methods in Dashboard (cards, Link, etc.). For Norway online tickets, keep Vipps on the Nexi path when Nexi is primary; do not invent a second Vipps stack on Stripe unless product decides otherwise.

---

## 2. Environment & keys

| Item | Recommendation |
|------|----------------|
| Dev / CI | Separate [Stripe Sandboxes](https://docs.stripe.com/sandboxes) (not shared test mode) |
| Key type | Prefer **restricted API key** (`rk_`) with least privilege over full `sk_` |
| Secrets | Env / vault only — never commit. Current workspace keys are **placeholders** |
| Active provider | `PAYMENT_PROVIDER=stripe` for Xo sales while Nexi onboards |
| Mock | `STRIPE_MOCK_MODE=false` whenever real keys are used |

Required env:

```bash
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=rk_test_…   # or sk_test_… for first sandbox
STRIPE_WEBHOOK_SECRET=whsec_…
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_MOCK_MODE=false
APP_URL=https://your-domain
```

Webhook endpoint: `{APP_URL}/api/payments/stripe/webhook`  
Events (minimum): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `payment_intent.payment_failed`

---

## 3. Phase A — Online Payments (P0, already largely built)

### Flow (keep)

Customer selects tickets → reservation → immutable order snapshot → Stripe Checkout Session → customer pays → webhook verifies amount/currency → order confirmed → tickets issued once → QR.

### Already good in Ticketly

- Checkout Sessions + idempotency key `checkout_${orderId}`
- Webhook signature verification
- Unique `(provider, eventId)` webhook rows
- Amount / currency validation before fulfill
- Provider stored on `Payment` forever
- Refunds resolve provider from payment record (not current env)
- Dual-provider health / diagnostics

### Gaps vs Stripe best practices (fix next)

1. Handle **`checkout.session.async_payment_succeeded`** (and failed) — fulfill only when `payment_status !== unpaid`
2. Prefer instantiating **`Stripe` client once** / latest SDK API version (`2026-09-30.endive` family)
3. Add Dashboard **statement descriptor** review (`XO DRAMMEN` / legal short name)
4. Optional: `integration_identifier` on Checkout Sessions for flow analytics
5. Switch to restricted key once request logs are known
6. Ensure success URL never marks order paid (already true)

### Xo-specific Checkout config

- Currency: **NOK**
- Statement / descriptor: nightclub-recognizable (avoid disputes)
- Age gate remains Ticketly event `ageLimit` (18–24 positioning is marketing; enforcement is door + event settings)
- Metadata: `orderId`, `orderNumber`, `organizationId`, `eventId` (safe only — no secrets)

---

## 4. Phase B — Terminal (P1 for door / walk-up)

Use when guests pay **at the door** or for add-ons (not pre-sold tickets).

| Step | Action |
|------|--------|
| Hardware | Stripe Reader (WisePOS E / S700 / BBPOS) registered to account |
| Location | Create Terminal Location (Drammen venue address) |
| Online tickets | Keep Checkout — Terminal is **card_present only** |
| API | `PaymentIntent` with `payment_method_types: ['card_present']` (**only** valid use of that param) |
| Connection | Terminal SDK / Server-driven: create PI → collect on reader → webhook / confirm |

Suggested Ticketly model later:

- `DoorSale` or `Order.source = TERMINAL`
- Same ticket issuance path after PI `succeeded`
- Never mix Terminal PI into online Checkout session

**Out of scope for first online launch** — can sell tickets with Checkout alone.

---

## 5. Phase C — Invoicing (P2 / B2B)

Use for:

- Table packages / bottle service deposits
- Corporate bookings
- Promoter settlements (if invoicing customers, not Connect payouts)

| Step | Action |
|------|--------|
| Customer | Stripe Customer per buyer org / promoter |
| Invoice | Create draft → line items → finalize → send |
| Payment | Customer pays hosted invoice URL |
| Ticketly | On `invoice.paid`, create Order snapshot + tickets if productized |

Prefer Invoicing over manual Payment Links for auditability. Not required for standard guest ticket checkout.

---

## 6. Launch checklist (Xo + Stripe)

- [ ] Stripe account under correct legal entity (Xo / operating company)
- [ ] Business verification complete
- [ ] Sandbox keys in preview; live keys only on production
- [ ] Webhook endpoint live + signature secret
- [ ] Bank settlement account (NOK)
- [ ] Statement descriptor reviewed
- [ ] Test Checkout purchase → QR → scan once → refund → QR rejected
- [ ] `PAYMENT_PROVIDER=stripe` documented for ops
- [ ] When Nexi READY: flip new checkouts to `nexi`; leave historical Stripe orders alone

---

## 7. What not to build yet

- Automatic Nexi → Stripe failover mid-payment
- Marketplace / Connect for Xo (single merchant)
- Social ads / discovery
- Hardcoded `payment_method_types: ['card']` on Checkout

---

## 8. Build order

1. **Paste real test keys** into secrets / `.env` (replace placeholders)
2. Enable Stripe MCP in Cursor Desktop (`https://mcp.stripe.com` + OAuth) for planner/tools
3. Harden webhook async events + smoke test Checkout
4. Go live on Stripe for ticket sales
5. Add Terminal when door card-present is needed
6. Add Invoicing when B2B table packages need formal invoices
