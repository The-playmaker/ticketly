# Launch Checklist — Ticketly

## READY in code (this branch)

- [x] Security hardening merged (payments, races, QR hash, access tokens, webhooks)
- [x] Organizer create-event wizard (`/admin/events/new`)
- [x] Ticket capacity vs **released** inventory
- [x] Pause / resume sales (event + ticket type)
- [x] Release +25/+50/+100 inventory
- [x] Controlled price change + `PriceHistory` (active reservations keep snapshot)
- [x] Live admin sales feed (8s poll)
- [x] Funnel counters via analytics track API
- [x] Customer availability display modes + pause messaging
- [x] Open Graph metadata on event pages
- [x] Upstash Redis rate-limit provider (no Vercel KV)
- [x] Vercel deployment docs + env validation helper
- [x] **Nexi Checkout** as primary `PaymentProvider` (`PAYMENT_PROVIDER=nexi`)
- [x] Nexi webhook idempotency + amount/currency verification
- [x] Embedded checkout page (Ticketly layout + Nexi payment UI)
- [x] Success page polls status (redirect is not payment proof)
- [x] Refund path via Nexi charge refunds
- [x] Waitlist table stub (no full waitlist UI)

## MANUAL CONFIG REQUIRED — payments (Nexi)

Production launch requires:

- [ ] Nexi Checkout production account active
- [ ] Test integration keys configured (preview / staging)
- [ ] Production integration keys configured in Vercel
- [ ] Vipps enabled if required
- [ ] Visa/Mastercard enabled
- [ ] Apple Pay enabled if we choose to launch it
- [ ] Google Pay enabled if we choose to launch it
- [ ] Production webhook URL configured (`{APP_URL}/api/payments/nexi/webhook`)
- [ ] `PAYMENT_PROVIDER=nexi`
- [ ] `NEXI_ENVIRONMENT=production` on production; `test` on preview
- [ ] `NEXI_SECRET_API_KEY` / `NEXI_CHECKOUT_KEY` / `NEXI_WEBHOOK_SECRET` set
- [ ] Test payment completed end-to-end (see docs/NEXI_CHECKOUT.md sandbox flow)
- [ ] Refund tested
- [ ] Amount verification tested
- [ ] Duplicate webhook tested
- [ ] Order → ticket issuance verified
- [ ] QR → scanner verified
- [ ] Refunded ticket rejected by scanner

### Absolute rule

If payment configuration is missing in production: **do not** enable mock payments.
Checkout must return a configuration error.

## OPTIONAL / FALLBACK — Stripe

Stripe is **not** required for first production launch when using Nexi.

- [ ] (Optional) Stripe live/test keys if fallback needed
- [ ] (Optional) Stripe webhook endpoint
- [ ] `STRIPE_MOCK_MODE=false` whenever Stripe is used outside local mock

## Other pre-launch (non-payment)

- [ ] Production Postgres provisioned + `DATABASE_URL` on Vercel
- [ ] `npm run db:migrate` applied on production DB (includes Nexi schema migration)
- [ ] Production domain + SSL on Vercel
- [ ] `APP_URL` / `NEXT_PUBLIC_APP_URL` = production HTTPS URL
- [ ] `AUTH_SECRET` (≥32 chars) in production
- [ ] `TICKET_TOKEN_SECRET` / `OFFLINE_BUNDLE_SECRET` set
- [ ] Email provider configured (not `console`) for order confirmation
- [ ] Upstash Redis linked (recommended for rate limits)
- [ ] Seller of record: legal name, org.nr, address, customer service on Organization
- [ ] Terms + privacy + refund policy text approved
- [ ] Real event created with capacity / first release / price
- [ ] Admin + door staff accounts created
- [ ] Backup / PITR enabled on Postgres
- [ ] Uptime check on `/api/ready`

### LAUNCH

- [ ] Publish event
- [ ] Verify public URL on mobile
- [ ] Purchase one ticket end-to-end (Nexi)
- [ ] Confirm webhook + admin live counter
- [ ] Release initial ticket batch (e.g. 50)

### POST LAUNCH

- [ ] Watch payment failures / abandoned checkouts
- [ ] Watch reservations / inventory
- [ ] Watch conversion funnel
- [ ] Pause sales if anomaly; fix; resume
- [ ] Release more inventory as needed; change future price if planned

## STILL REQUIRES / OUT OF SCOPE for tomorrow

| Item | Status |
|------|--------|
| Full waitlist product | Stub only |
| Event duplication | TODO |
| Vercel Blob image upload UI | URL field works; Blob token optional |
| Automatic batch progression UI | Schema ready; MANUAL default |
| Platform mega-dashboard | Partial via org admin + webhooks monitor |
| Native mobile App Store + Nexi SDK | Not required for web sales — see MOBILE_PAYMENTS.md |

## First real event recipe

1. Login as organizer → **Nytt arrangement**
2. Capacity `500`, ticket Ordinær `249 kr`, total allocation `500`, **first release `50`**, max 6
3. Publish
4. Share `/events/{slug}`
5. When low: **Release +50**
6. Optionally **Endre pris** to `299 kr` (active carts keep old price)

## Readiness labels (Nexi production dependencies)

| Dependency | Status |
|------------|--------|
| Code + provider + webhooks + docs | **READY** |
| Vercel env keys / Nexi portal account | **MANUAL CONFIG REQUIRED** |
| Real Nexi test payment → webhook → QR → refund → scanner | **BLOCKED** until manually executed |
