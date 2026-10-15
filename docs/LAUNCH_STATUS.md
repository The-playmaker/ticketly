# Launch Status — Ticketly

Strict readiness for **real ticket sales**. Build success alone does **not** mean payment production is ready.

## READY (in code)

- Event create / capacity / released inventory / pause / resume / release ± / change price
- Reservation price snapshots + `PriceHistory`
- Live admin polling (8s) with privacy-safe sales feed
- Customer sold-out / pause messaging
- **NexiCheckoutProvider** as `PAYMENT_PROVIDER=nexi` default
- Nexi webhook idempotency, amount/currency verification, `REVIEW_REQUIRED`
- Embedded checkout + `NexiCheckoutContainer` + backend-driven checkout states
- Success page polls — redirect is never payment proof
- QR tickets + scanner (VALID / ALREADY_USED / INVALID / WRONG_EVENT / REFUNDED)
- Organizer admin shell: overview, event ops, orders, attendees, analytics, settings
- Central inventory formula (`inventorySnapshot` / `eventInventorySnapshot`)
- Domain error `INVENTORY_BELOW_COMMITTED`
- UTM attribution on orders + funnel analytics emitters
- System health: DB / Nexi config / webhooks / email / Redis
- Vercel + Nexi docs; Stripe moved to optional fallback
- Unit tests for Nexi provider + inventory formula + checkout states

## MANUAL CONFIG REQUIRED

- [ ] Vercel production deploy
- [ ] Production PostgreSQL + `DATABASE_URL`
- [ ] `npm run db:migrate` (incl. Nexi + UTM migrations)
- [ ] `AUTH_SECRET` (≥32)
- [ ] `APP_URL` / `NEXT_PUBLIC_APP_URL` (HTTPS)
- [ ] `PAYMENT_PROVIDER=nexi`
- [ ] Nexi **test** keys on preview (`NEXI_ENVIRONMENT=test`)
- [ ] Nexi **production** keys on production
- [ ] `NEXI_WEBHOOK_SECRET` + webhook URL `{APP_URL}/api/payments/nexi/webhook`
- [ ] Vipps enabled on merchant if desired
- [ ] Cards (Visa/Mastercard) enabled
- [ ] Apple Pay / Google Pay only if consciously launched
- [ ] Email provider (not `console`) for confirmations
- [ ] Seller legal name, org.nr, address, customer service
- [ ] Terms / privacy / refund policy links
- [ ] Real event + initial release configured
- [ ] Upstash Redis recommended for multi-instance rate limits

## BLOCKED (until manually proven)

Production payment remains **BLOCKED** until a successful **Nexi sandbox** round-trip:

1. Ticketly checkout → Nexi test payment  
2. Webhook received & processed  
3. Order PAID → tickets once  
4. QR visible  
5. Admin counters update  
6. Refund → ticket REFUNDED  
7. Scanner rejects refunded QR  

Also blocked without: production DB migrate, production domain/SSL, real seller data.

| Item | Status |
|------|--------|
| Code path for Nexi | READY |
| Real Nexi test transaction + webhook | **BLOCKED** |
| Production live keys in Vercel | MANUAL CONFIG |

## OPTIONAL AFTER LAUNCH

- Native Expo organizer payment / full mobile admin analytics
- Standalone Vipps ePayment API (Vipps via Nexi is enough for v1)
- Stripe as fallback (`PAYMENT_PROVIDER=stripe`)
- Waitlist product UI
- Event duplication
- WebSockets (8s poll is acceptable)
- Surge / dynamic pricing (explicitly out of scope)

## Verification commands (engineering)

```bash
npm run typecheck
npm run lint
npm test                 # unit; integration needs Postgres
npm run build -w @ticketly/web
```

See also: [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md), [NEXI_CHECKOUT.md](./NEXI_CHECKOUT.md), [PAYMENTS.md](./PAYMENTS.md).
