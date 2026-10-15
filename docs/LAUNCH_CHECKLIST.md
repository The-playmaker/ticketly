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

## OPTIONAL / FALLBACK — Stripe

Not required when `PAYMENT_PROVIDER=nexi`.

- [ ] (Optional) Stripe keys if fallback needed
- [ ] `STRIPE_MOCK_MODE=false` whenever Stripe is used outside local mock

## Absolute rules

- Missing payment config in production → **fail closed** (no silent mock)
- Browser success URL alone never marks order paid
- Do not mark payment production READY without Nexi sandbox round-trip
