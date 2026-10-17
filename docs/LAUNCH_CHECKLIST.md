# Launch Checklist — Ticketly

See [LAUNCH_STATUS.md](./LAUNCH_STATUS.md) for READY / MANUAL / BLOCKED.

## READY in code

- [x] Organizer create-event + inventory controls
- [x] Stripe Checkout Form current production (`PAYMENT_PROVIDER=stripe`)
- [x] Webhook idempotency + payment verification
- [x] Embedded checkout + checkout UI states
- [x] Admin shell: events, orders, attendees, analytics, settings
- [x] Central inventory formula + `INVENTORY_BELOW_COMMITTED`
- [x] UTM on orders + funnel tracking emitters
- [x] System health endpoint
- [x] QR + scanner unchanged security model
- [x] Nexi available as future / optional provider

## Critical manual items

- [ ] Vercel production deploy
- [ ] Production PostgreSQL
- [ ] DB migrations
- [ ] `AUTH_SECRET`
- [ ] `APP_URL` / `NEXT_PUBLIC_APP_URL` (`https://billett.xodrammen.no`)
- [ ] Stripe live keys + webhook (see below)
- [ ] Cards enabled in Stripe Dashboard
- [ ] Email provider configured
- [ ] Seller legal data correct
- [ ] Terms / privacy / refund links
- [ ] Real event created
- [ ] Initial release configured
- [ ] End-to-end test purchase (Stripe)
- [ ] Refund tested
- [ ] QR tested
- [ ] Scanner tested

## STRIPE (current production PSP)

Required for live sales. Nexi is **not** required today.

- [ ] Correct legal business Stripe account
- [ ] Business verification complete
- [ ] `PAYMENT_PROVIDER=stripe`
- [ ] Production API keys (`STRIPE_SECRET_KEY=sk_live_…`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`)
- [ ] Production webhook → `https://billett.xodrammen.no/api/payments/stripe/webhook`
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_…`
- [ ] `STRIPE_MOCK_MODE=false` (never mock in production)
- [ ] Correct bank settlement account
- [ ] Statement descriptor reviewed
- [ ] Test / live payment completed
- [ ] Refund tested
- [ ] QR generated
- [ ] Refunded QR rejected

## NEXI (future / optional)

When switching later to Nexi: set `PAYMENT_PROVIDER=nexi` + Nexi production keys/webhook.
Do **not** migrate old Stripe payments.

## Absolute rules

- Missing payment config in production → **fail closed** (no silent mock)
- Browser success URL alone never marks order paid
- No automatic Nexi → Stripe failover after a payment has started
- Do not mark Nexi production READY without Nexi sandbox round-trip
- Stripe may be READY for sales independently of Nexi
