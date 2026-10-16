# Launch Status — Ticketly

Strict readiness for **real ticket sales**. Build success alone does **not** mean payment production is ready.

Statuses: **READY** | **PARTIAL** | **BLOCKED** | **OPTIONAL AFTER LAUNCH** | **MANUAL CONFIG REQUIRED**

Related: [EVENTBRITE_PARITY.md](./EVENTBRITE_PARITY.md) · [NEXI_SANDBOX_VALIDATION.md](./NEXI_SANDBOX_VALIDATION.md) · [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)

---

## Active production provider

| Setting | Value |
|---------|--------|
| **Active for new checkouts** | Set via `PAYMENT_PROVIDER` |
| Recommended first sales (while Nexi onboards) | `PAYMENT_PROVIDER=stripe` |
| Long-term primary target | `PAYMENT_PROVIDER=nexi` |

**Nexi Checkout:** ONBOARDING / TEST (code READY; live keys & public webhook not verified here)

**Stripe:** TEST / READY for sales when production keys + webhook configured (independent of Nexi)

When Stripe is active and verified: **Ticketly: READY FOR SALES USING STRIPE**

Switching to Nexi later does **not** change historical Stripe orders.

---

## Capability report (this phase)

| Area | Status | Notes |
|------|--------|-------|
| **PAYMENTS** | **PARTIAL** | Dual provider architecture READY. Nexi sandbox live E2E **BLOCKED** without TEST keys. Stripe production-usable when keys/webhook set. No auto-failover. |
| **PROMO** | **READY** | Backend pricing, FOR UPDATE usage limits, admin Marketing / Promo Codes UI. |
| **WAITLIST** | **READY** | Join / invite / claim / expire; sold-out CTA; admin invite next 10/25/custom. |
| **BUNDLES** | **PARTIAL** | `admissionCount` + `isBundle` → N individual QR tickets. Table packages later. |
| **REMINDERS** | **PARTIAL** | 24h/3h jobs + cron; organizer toggles; ESP delivery webhooks optional. |
| **EXPORTS** | **READY** | CSV/XLSX for orders, tickets, attendees, guestlist, check-ins, refunds, promos. Org-scoped. |
| **SUPPORT** | **READY** | Org-wide search + order detail (payment, tickets, transfers, notifications, audit). Masked provider refs. |
| **EVENT SERIES** | **PARTIAL** | `EventSeries` model + duplicate event. Recurring generation UI optional after launch. |

---

## Payment providers (detail)

### Nexi Checkout

| Criterion | Status |
|-----------|--------|
| Code + webhook idempotency | READY |
| Sandbox live payment | BLOCKED (no TEST keys in this environment) |
| Production merchant | ONBOARDING |
| Mark READY when | All sandbox READY criteria in checklist pass |

### Stripe (backup / temporary primary)

| Criterion | Status |
|-----------|--------|
| `StripePaymentProvider` + mock | READY |
| Webhook `POST /api/payments/stripe/webhook` | READY (signature + unique event id) |
| Provider persisted on Payment | READY |
| Refunds use stored provider | READY (proven in tests after default → Nexi) |
| Production keys | MANUAL CONFIG REQUIRED |

**STRIPE BACKUP checklist**

- [ ] Correct legal business Stripe account
- [ ] Business verification complete
- [ ] Production API keys configured
- [ ] Production webhook configured (`/api/payments/stripe/webhook`)
- [ ] Correct bank settlement account
- [ ] Statement descriptor reviewed
- [ ] Test payment completed
- [ ] Refund tested
- [ ] QR generated
- [ ] Refunded QR rejected

Stripe may be marked **READY** independently of Nexi.

---

## By area (platform)

| Area | Status | Notes |
|------|--------|-------|
| **Database** | **READY** | Migrations include Eventbrite parity (`EventSeries`, waitlist, bundles, reminders). |
| **Auth** | **MANUAL CONFIG REQUIRED** | Production `AUTH_SECRET` on Vercel. |
| **Webhook (Nexi public)** | **BLOCKED** | Idempotency READY in code/tests; public HTTPS not proven. |
| **Email** | **BLOCKED** | Still `EMAIL_PROVIDER=console` until ESP configured. |
| **Ticket issuing** | **READY** | Once-only; bundles multiply by `admissionCount`. |
| **QR / Scanner** | **READY** (code) | Live after-payment depends on payment provider smoke. |
| **Refund** | **READY** (code) | Uses payment.provider; live provider refund pending keys. |
| **Admin** | **READY** | Promos, waitlist, support search, dual-provider diagnostics, exports. |
| **Vercel** | **MANUAL CONFIG REQUIRED** | Deploy + env + webhooks. |

---

## Launch priority

**P0** — Stripe production fallback · Nexi remains primary target  
**P1** — Promo · Waitlist · Exports · Support lookup  
**P2** — Reminders · Bundles · Event series / duplicate  

Do not delay sales launch for P2.

---

## Absolute rules

1. Never change payment provider for an existing payment/order.
2. Never auto-failover mid-payment from Nexi → Stripe.
3. Browser redirect alone never marks an order paid.
4. Mock payments forbidden in production.
