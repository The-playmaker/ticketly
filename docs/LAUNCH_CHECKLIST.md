# Launch Checklist — Ticketly

See [LAUNCH_STATUS.md](./LAUNCH_STATUS.md) for READY / MANUAL / BLOCKED.

## READY in code

- [x] Organizer create-event + inventory controls
- [x] Nexi Checkout primary (`PAYMENT_PROVIDER=nexi`)
- [x] Webhook idempotency + payment verification
- [x] Embedded checkout + checkout UI states
- [x] Admin shell: events, orders, attendees, analytics, settings
- [x] Central inventory formula + `INVENTORY_BELOW_COMMITTED`
- [x] UTM on orders + funnel tracking emitters
- [x] System health endpoint
- [x] QR + scanner unchanged security model
- [x] Stripe optional / not required for launch

## Critical manual items

- [ ] Vercel production deploy
- [ ] Production PostgreSQL
- [ ] DB migrations
- [ ] `AUTH_SECRET`
- [ ] `APP_URL`
- [ ] Nexi production keys
- [ ] Nexi webhook configured
- [ ] Vipps enabled if desired
- [ ] Cards enabled
- [ ] Email provider configured
- [ ] Seller legal data correct
- [ ] Terms / privacy / refund links
- [ ] Real event created
- [ ] Initial release configured
- [ ] End-to-end test purchase (Nexi)
- [ ] Refund tested
- [ ] QR tested
- [ ] Scanner tested

## STRIPE BACKUP (temporary / live fallback)

Use while Nexi onboarding is pending: `PAYMENT_PROVIDER=stripe`.

Does **not** require Nexi to be READY. Historical Stripe orders stay on Stripe forever.

- [ ] Correct legal business Stripe account
- [ ] Business verification complete
- [ ] Production API keys configured (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
- [ ] Production webhook configured → `{APP_URL}/api/payments/stripe/webhook`
- [ ] `STRIPE_WEBHOOK_SECRET` set
- [ ] Correct bank settlement account
- [ ] Statement descriptor reviewed
- [ ] Test payment completed
- [ ] Refund tested
- [ ] QR generated
- [ ] Refunded QR rejected
- [ ] `STRIPE_MOCK_MODE=false` (never mock in production)

When switching later to Nexi: set `PAYMENT_PROVIDER=nexi`. Do **not** migrate old payments.

## Absolute rules

- Missing payment config in production → **fail closed** (no silent mock)
- Browser success URL alone never marks order paid
- No automatic Nexi → Stripe failover after a payment has started
- Do not mark Nexi production READY without Nexi sandbox round-trip
- Stripe may be READY for sales independently of Nexi
