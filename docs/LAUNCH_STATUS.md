# Launch Status — Ticketly

Strict readiness for **real ticket sales**. Build success alone does **not** mean payment production is ready.

Statuses: **READY** | **MANUAL CONFIG REQUIRED** | **BLOCKED**

Evidence for this cycle: [NEXI_SANDBOX_VALIDATION.md](./NEXI_SANDBOX_VALIDATION.md)

---

## By area

| Area | Status | Notes |
|------|--------|-------|
| **Database** | **READY** | Postgres migrated (`migrate deploy`, 5 migrations). Integration tests 51/51 green against live DB. |
| **Auth** | **MANUAL CONFIG REQUIRED** | Code ready; production `AUTH_SECRET` (≥32) must be set on Vercel. |
| **Nexi sandbox** | **BLOCKED** | Code + DB tests READY. **No actual Nexi TEST payment** — portal TEST keys not present; public webhook not proven. |
| **Nexi production** | **BLOCKED** | Do not enable until sandbox READY criteria all checked. Live keys not configured. |
| **Vipps** | **MANUAL CONFIG REQUIRED** | Via Nexi Checkout when merchant enables Vipps. Not activated/tested here → production Vipps **BLOCKED** until sandbox Vipps succeeds. |
| **Cards** | **MANUAL CONFIG REQUIRED** | Visa/Mastercard via Nexi merchant. Card sandbox not run (no TEST keys). |
| **Webhook** | **BLOCKED** | Idempotency + amount checks **READY** in code/tests. **Public HTTPS webhook (Vercel)** not verified. |
| **Email** | **BLOCKED** | Still `EMAIL_PROVIDER=console`. Replace before production. |
| **Ticket issuing** | **READY** | Once-only issuance proven in integration tests; live sandbox pending. |
| **QR** | **READY** (code) / live sandbox **BLOCKED** | Issue + display path ready; live after-payment QR not run. |
| **Scanner** | **READY** (code) | VALID → ALREADY_USED; REFUNDED rejected. Offline: see `OFFLINE_SCANNER.md` (stale until sync). |
| **Refund** | **READY** (code) / live **BLOCKED** | Double-refund protected in tests; actual Nexi TEST refund not run. |
| **Admin** | **READY** | Orders, attendees, analytics, settings, webhook monitor, payment health, diagnostics `/admin/platform/payments/diagnostics`. |
| **Inventory** | **READY** | Snapshots, release, sold-out, pause; below-committed domain error. |
| **Analytics** | **READY** | UTM on orders + funnel emitters; admin analytics views. |
| **Vercel** | **MANUAL CONFIG REQUIRED** | Docs ready. Preview/staging deploy + Nexi→Vercel webhook **not run** in this environment (no Vercel credentials). |

---

## Nexi sandbox READY criteria

Mark **Nexi sandbox** READY only when **all** are verified:

- [ ] Actual Nexi TEST checkout loaded
- [ ] Actual test payment completed
- [ ] Public webhook received
- [ ] Amount verified
- [ ] Currency verified
- [ ] Order confirmed
- [ ] Exactly one ticket generated
- [ ] QR displayed
- [ ] Scanner accepts once
- [ ] Scanner rejects duplicate
- [ ] Actual TEST refund completed
- [ ] Ticket becomes REFUNDED
- [ ] Scanner rejects refunded ticket
- [ ] Admin metrics update
- [ ] No secrets exposed

**Current:** incomplete — integration/code checks only. See evidence doc.

---

## Production payments READY criteria

Do **not** mark production payments READY until sandbox passes **and**:

- [ ] Production Nexi merchant active
- [ ] Live keys configured on Vercel
- [ ] Live webhook configured
- [ ] Required payment methods active (cards / Vipps as intended)
- [ ] Production DB migrated
- [ ] Production email provider active
- [ ] Seller legal information configured
- [ ] Checkout terms / privacy / refund policy live

**Do not** perform an automatic live customer charge. A controlled live smoke test remains **human-gated** after the above.

---

## MANUAL CONFIG REQUIRED (operator checklist)

- [ ] Vercel preview + production projects
- [ ] Production / staging PostgreSQL + `DATABASE_URL`
- [ ] `npm run db:migrate` on each environment (never force reset)
- [ ] `AUTH_SECRET`, `TICKET_TOKEN_SECRET`, `OFFLINE_BUNDLE_SECRET`
- [ ] `APP_URL` / `NEXT_PUBLIC_APP_URL` (HTTPS)
- [ ] `PAYMENT_PROVIDER=nexi`
- [ ] Nexi **TEST** keys on preview (`NEXI_ENVIRONMENT=test`)
- [ ] Nexi **production** keys on production (`NEXI_ENVIRONMENT=production`)
- [ ] `NEXI_WEBHOOK_SECRET` + URL `{APP_URL}/api/payments/nexi/webhook`
- [ ] Vipps enabled on merchant if desired → then test
- [ ] Cards enabled
- [ ] Apple Pay / Google Pay only if consciously launched
- [ ] Email provider ≠ `console`
- [ ] Seller legal name, org.nr, address, customer service
- [ ] Terms / privacy / refund policy links
- [ ] Real seller org + real event (not `ticketly-payment-test`)
- [ ] Upstash Redis recommended for multi-instance rate limits

---

## Cancel path

Ticketly Nexi checkout uses **`charge: true`** (authorize + capture). Provider cancel for authorized-but-not-captured is **not** part of the normal ticket flow — documented in [NEXI_CHECKOUT.md](./NEXI_CHECKOUT.md), not fabricated as E2E coverage.

---

## Verification commands

```bash
npm run db:migrate
npm run db:seed          # includes TEST EVENT — Ticketly Payment Test
npm run typecheck
npm run lint
npm test                 # unit + DB integration (needs Postgres)
npm run build -w @ticketly/web
```

Diagnostics (SUPER_ADMIN): `/admin/platform/payments/diagnostics`

See also: [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md), [NEXI_CHECKOUT.md](./NEXI_CHECKOUT.md), [NEXI_SANDBOX_VALIDATION.md](./NEXI_SANDBOX_VALIDATION.md), [PAYMENTS.md](./PAYMENTS.md).
