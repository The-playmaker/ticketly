# Launch Checklist — Ticketly

## READY in code (this branch)

- [x] Security hardening merged (payments, races, QR hash, access tokens, webhooks)
- [x] Organizer create-event wizard (`/admin/events/new`)
- [x] Ticket capacity vs **released** inventory
- [x] Pause / resume sales (event + ticket type)
- [x] Release +25/+50/+100 inventory
- [x] Controlled price change + `PriceHistory` (existing reservations keep snapshot)
- [x] Live admin sales feed (8s poll)
- [x] Funnel counters (page views / checkout / paid) via analytics track API
- [x] Customer availability display modes + pause messaging
- [x] Open Graph metadata on event pages
- [x] Upstash Redis rate-limit provider (no Vercel KV)
- [x] Vercel deployment docs + env validation helper
- [x] Waitlist table stub (no full waitlist UI)
- [x] Inventory scenario integration test (file)

## Manual configuration BEFORE real ticket sales

### PRE-LAUNCH

- [ ] Production Postgres provisioned + `DATABASE_URL` set on Vercel
- [ ] `npm run db:migrate` applied on production DB
- [ ] Production domain + SSL on Vercel
- [ ] `APP_URL` / `NEXT_PUBLIC_APP_URL` = production HTTPS URL
- [ ] `AUTH_SECRET` (≥32 chars) in production
- [ ] `TICKET_TOKEN_SECRET` / `OFFLINE_BUNDLE_SECRET` set
- [ ] Stripe **live** keys (or test keys if soft-launch) + webhook endpoint
- [ ] `STRIPE_MOCK_MODE=false` in production
- [ ] Email provider configured (not `console`) for order confirmation
- [ ] Upstash Redis linked (recommended for rate limits)
- [ ] Seller of record: legal name, org.nr, address, customer service on Organization
- [ ] Terms + privacy + refund policy text approved
- [ ] Real event created (not seed demo) with capacity / first release / price
- [ ] Admin + door staff accounts created
- [ ] Test purchase (Stripe test or 1 live) → email → QR → scanner
- [ ] Test refund path
- [ ] Backup / PITR enabled on Postgres
- [ ] Uptime check on `/api/ready`

### LAUNCH

- [ ] Publish event
- [ ] Verify public URL on mobile
- [ ] Purchase one ticket end-to-end
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
| Platform `/admin/platform` mega-dashboard | Partial via org admin |
| Native mobile App Store release | Not required for web sales |

## First real event recipe

1. Login as organizer → **Nytt arrangement**  
2. Capacity `500`, ticket Ordinær `249 kr`, total allocation `500`, **first release `50`**, max 6  
3. Publish  
4. Share `/events/{slug}`  
5. When low: **Release +50**  
6. Optionally **Endre pris** to `299 kr` (active carts keep old price)
