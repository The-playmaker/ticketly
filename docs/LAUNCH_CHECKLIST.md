# Launch Checklist — Ticketly

See [LAUNCH_STATUS.md](./LAUNCH_STATUS.md) for READY / MANUAL / BLOCKED.
Payments detail: [PAYMENTS.md](./PAYMENTS.md).

## READY in code

- [x] Organizer create-event + inventory controls
- [x] Nets Easy (Nexi) primary + Stripe create-time backup (`PAYMENT_PROVIDER=nexi`, `PAYMENT_BACKUP_PROVIDER=stripe`)
- [x] Shared `PaymentProvider` adapters, webhook idempotency, amount/currency/order checks
- [x] Exactly-once ticket fulfillment via `markOrderPaid`
- [x] Never downgrade PAID on delayed failure/cancel webhooks
- [x] Independent payment attempts + status pre-check (no double charge path)
- [x] Stripe reconciliation CLI/UI + Nexi reconciliation CLI/cron
- [x] Embedded checkout (Nexi + Stripe Form) + success-URL polling (redirect ≠ paid)
- [x] Admin shell: events, orders, attendees, analytics, settings, payment attempts
- [x] Central inventory formula + reservation repair/cleanup
- [x] DOOR_STAFF scanner-only + EventAssignment
- [x] Refund via original `Payment.provider` (gross/net reporting)
- [x] QR + scanner security model

## Critical manual items

- [ ] Vercel production deploy
- [ ] Production PostgreSQL + migrations
- [ ] `AUTH_SECRET`
- [ ] `APP_URL` / `NEXT_PUBLIC_APP_URL` (`https://billett.xodrammen.no`)
- [ ] Nets Easy production keys + webhook
- [ ] Stripe live backup keys + webhook (if backup enabled)
- [ ] Email provider configured (`EMAIL_PROVIDER=resend`)
- [ ] Seller legal data correct
- [ ] Terms / privacy / refund links
- [ ] Real event created + inventory released
- [ ] End-to-end test purchase (Nexi test → then production)
- [ ] Refund tested on original provider
- [ ] QR + scanner tested

## Nets Easy (primary)

- [ ] `PAYMENT_PROVIDER=nexi`
- [ ] `NEXI_ENVIRONMENT=production`
- [ ] `NEXI_SECRET_API_KEY` / `NEXI_CHECKOUT_KEY` / `NEXI_WEBHOOK_SECRET` (8–64 alphanumeric)
- [ ] Webhook path `{APP_URL}/api/payments/nexi/webhook`
- [ ] Sandbox round-trip completed before live

## Stripe (create-time backup)

- [ ] `PAYMENT_BACKUP_PROVIDER=stripe` (or `PAYMENT_STRIPE_BACKUP=true`)
- [ ] Live keys + `STRIPE_WEBHOOK_SECRET`
- [ ] `STRIPE_MOCK_MODE=false`
- [ ] Webhook `{APP_URL}/api/payments/stripe/webhook`
- [ ] Failover only when Nexi is definitively unavailable **before** payment creation

## Absolute rules

- Missing payment config in production → **fail closed** (no silent mock)
- Browser success URL alone never marks order paid
- No mid-payment provider switch; no failover on unknown/pending/5xx/network
- Never downgrade PAID / PARTIALLY_REFUNDED / REFUNDED on delayed failure
- Refunds always via original payment provider
- Do not add Vercel Hobby-blocked crons to `vercel.json` — invoke `/api/cron/*` externally with `CRON_SECRET`
