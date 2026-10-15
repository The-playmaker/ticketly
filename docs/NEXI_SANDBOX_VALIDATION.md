# Nexi Sandbox Validation Evidence

**Date:** 2026-10-15  
**Environment under test:** Local PostgreSQL + code path verification  
**NEXI_ENVIRONMENT:** `test` (intended)  
**PAYMENT_PROVIDER:** must be `nexi` for live sandbox (local `.env` still uses `mock` until real keys)

> Secret values are never recorded here. Only configured/missing state and public identifiers.

---

## 1. Database

| Check | Result |
|-------|--------|
| `npm run db:migrate` (`prisma migrate deploy`) | **PASS** — 5 migrations applied, none pending |
| Tables present | **PASS** — `Payment`, `Refund`, `WebhookEvent` (PaymentWebhookEvent), `OrganizationPaymentConfiguration`, `Order`, `OrderSnapshot`, `Ticket`, `TicketReservation` |
| Schema match | **PASS** — columns include Nexi fields (`providerChargeId`, `paymentMethod`, `providerMetadata`, webhook `(provider,eventId)` unique) |
| Force reset used | **No** |

## 2. Database integration tests

Command: `npm test -w @ticketly/web` with live `DATABASE_URL`.

| Suite | Result |
|-------|--------|
| Reservation / order / payment / fulfillment | **PASS** |
| Nexi webhook + duplicate webhook | **PASS** |
| Amount mismatch → `REVIEW_REQUIRED` | **PASS** (automated) |
| Refund + double refund protection | **PASS** |
| Ticket invalidation / inventory release | **PASS** |
| Price snapshot | **PASS** |
| Organization isolation | **PASS** |
| Skipped DB integration tests left | **None** |

**Totals:** 7 files, **51/51** tests passed.

## 3. Nexi config validation

Startup (`instrumentation` → `validateServerEnv`) + `assertNexiConfiguredForRuntime`:

| Item | Status |
|------|--------|
| `PAYMENT_PROVIDER=nexi` required for real checkout | Enforced (no auto mock/Stripe fallback) |
| Placeholder key detection | **PASS** — rejects `*placeholder*`, `*from-portal*`, `change-me`, etc. |
| Current workspace keys | **Missing / placeholder** — real portal TEST keys not present |
| Diagnostics page | `/admin/platform/payments/diagnostics` (SUPER_ADMIN) |

When `PAYMENT_PROVIDER=nexi` and keys are missing/placeholder, process **fails clearly**. It does **not** fall back to mock, Stripe, or fake success.

## 4. Test event

Seed creates isolated event:

| Field | Value |
|-------|--------|
| Name | `TEST EVENT — Ticketly Payment Test` |
| Slug | `ticketly-payment-test` |
| Capacity / released | 10 / 10 |
| Price | 10.00 NOK (`1000` øre) |
| Marker | **TEST EVENT** in name + description |

Recreate: `npm run db:seed`

## 5–14. Real Nexi sandbox transaction

| Step | Status | Notes |
|------|--------|-------|
| Actual Nexi TEST checkout loaded | **FAIL / NOT RUN** | No real `NEXI_SECRET_API_KEY` / `NEXI_CHECKOUT_KEY` in environment |
| Actual test payment completed | **FAIL / NOT RUN** | Blocked on keys |
| Public webhook received | **FAIL / NOT RUN** | Requires public HTTPS (Vercel) + keys |
| Amount / currency verified | **PASS** (integration test only) | Code path covered; live webhook not exercised |
| Order confirmed + one ticket | **FAIL / NOT RUN** | Live path blocked |
| QR displayed | **FAIL / NOT RUN** | Live path blocked |
| Scanner VALID then ALREADY_USED | **PASS** (integration) | Live QR after sandbox payment not run |
| Actual TEST refund via Nexi API | **FAIL / NOT RUN** | Blocked on keys |
| Ticket REFUNDED + scanner reject | **PASS** (integration) | Live refund not run |
| Duplicate webhook replay | **PASS** (integration + admin replay tool) | No second fulfillment |
| Amount mismatch 1000 vs 999 | **PASS** (integration) | Order not fulfilled; `REVIEW_REQUIRED` |
| Success redirect without confirm | **PASS** (code path) | Success page polls backend; shows pending confirmation, not “Billettene dine er klare” |
| Double refund | **PASS** (integration) | Blocked / idempotent |
| Cancel (auth-only) | **DOCUMENTED** | Ticketly uses `charge: true` (immediate capture). Cancel is for authorized-but-not-captured only — **not** part of normal ticket sale flow. See `docs/NEXI_CHECKOUT.md`. |

### Evidence placeholders (fill after live sandbox)

| Field | Value |
|-------|--------|
| Ticketly order number | _pending live run_ |
| Nexi payment reference | _pending live run_ |
| Nexi payment method | _pending live run_ |
| Order status | _pending live run_ |
| Webhook event ID | _pending live run_ |
| Webhook processing status | _pending live run_ |
| Ticket ID | _pending live run_ |
| Ticket status | _pending live run_ |
| Reservation status | _pending live run_ |
| Inventory before / after | _pending live run_ |

## 15. Cancel

**Not fabricated.** Normal Ticketly Nexi flow uses immediate charge (`charge: true`). Provider cancel API exists for auth-only states; document-only for launch.

## 16. Payment method metadata

Admin payment detail shows provider-returned `paymentMethod` / `paymentType` when present (e.g. `VIPPS`, `MASTERCARD`). No fabricated last4 / wallet names.

## 17. Vipps through Nexi

| Item | Status |
|------|--------|
| Vipps on Nexi TEST merchant | **MANUAL CONFIG REQUIRED** — unknown / not activated in this environment |
| Card sandbox verification | Blocked until real TEST keys exist |
| Production Vipps launch | **BLOCKED** until Vipps activated **and** sandbox-tested |

## 18–19. Vercel staging + public webhook

| Item | Status |
|------|--------|
| Vercel preview deploy with `NEXI_ENVIRONMENT=test` | **FAIL / NOT RUN** — no `VERCEL_TOKEN` / project link in this agent environment |
| Public HTTPS webhook from Nexi → Vercel → DB → ticket | **FAIL / NOT RUN** — most important remaining deployment test |

## 20. Email

| Item | Status |
|------|--------|
| `EMAIL_PROVIDER` | `console` (logs only) |
| Order confirmation / ticket link / refund email via real provider | **NOT VERIFIED** |
| Production launch | **BLOCKED** until real email provider configured (or business accepts alternate verified channel) |

## 21–23. Admin / audit / isolation

| Item | Status |
|------|--------|
| Admin counters / payment health / webhook monitor | **READY** in code; live update after sandbox **NOT RUN** |
| Audit events (payment / ticket / check-in / refund) | **PASS** via integration coverage |
| Org A cannot see Org B payment/order/refund/webhook/tickets | **PASS** (integration) |

## 24. Production configuration checklist (manual)

Do **not** switch to live credentials automatically. Manual steps:

1. Create/configure production Nexi merchant  
2. Obtain production secret API key + checkout key  
3. Set Vercel production secrets (`PAYMENT_PROVIDER=nexi`, `NEXI_ENVIRONMENT=production`, keys, `NEXI_WEBHOOK_SECRET`, `APP_URL`)  
4. Configure production webhook URL `{APP_URL}/api/payments/nexi/webhook` in Nexi (Authorization = webhook secret)  
5. Enable Vipps if desired → then sandbox + production smoke  
6. Verify Visa/Mastercard; Apple Pay / Google Pay only if consciously enabled  
7. Configure production email provider (not `console`)  
8. Production DB: `npm run db:migrate` (never force reset)  
9. Create real seller organization + legal info  
10. Create real event + release inventory  
11. Terms / privacy / refund policy live  
12. Controlled live smoke test (optional, human-gated) — **do not auto-charge real customers**

## 25. Secrets review

Reviewed diagnostics, webhook monitor, health API, docs: **no secret values displayed**. Placeholders rejected by config validation.

## 26. Failure behavior

| Scenario | Expected | Status |
|----------|----------|--------|
| Nexi API unavailable | Controlled provider error; no fake paid order / ticket | **PASS** (unit) |
| Webhook delayed | Order stays pending / confirmation state | **PASS** (code) |
| Webhook permanently fails | Admin payment health / webhook monitor expose issue | **PASS** (code) |

## 27. READY criteria scorecard (sandbox)

| Criterion | Verified |
|-----------|----------|
| Actual Nexi TEST checkout loaded | ☐ |
| Actual test payment completed | ☐ |
| Public webhook received | ☐ |
| Amount verified | ☑ integration / ☐ live |
| Currency verified | ☑ integration / ☐ live |
| Order confirmed | ☐ live |
| Exactly one ticket generated | ☑ integration / ☐ live |
| QR displayed | ☐ live |
| Scanner accepts once | ☑ integration / ☐ live |
| Scanner rejects duplicate | ☑ integration / ☐ live |
| Actual TEST refund completed | ☐ |
| Ticket becomes REFUNDED | ☑ integration / ☐ live |
| Scanner rejects refunded ticket | ☑ integration / ☐ live |
| Admin metrics update | ☐ live |
| No secrets exposed | ☑ |

**Nexi sandbox overall:** **FAIL** until live TEST payment + public webhook + TEST refund are completed with real portal credentials on a public HTTPS URL.

## How to finish sandbox (operator)

1. Put real Nexi **TEST** keys in Vercel preview / local `.env` (`PAYMENT_PROVIDER=nexi`, `NEXI_ENVIRONMENT=test`).  
2. Deploy preview; set `APP_URL` to the preview HTTPS origin.  
3. Confirm diagnostics: all Configured.  
4. Open `/events/ticketly-payment-test` → buy 1 × Sandbox Ticket.  
5. Complete Nexi test payment.  
6. Confirm webhook row PROCESSED; order PAID; one ticket; QR works; refund; scanner.  
7. Paste sanitized IDs into the evidence table above.  
8. Update `docs/LAUNCH_STATUS.md`.
