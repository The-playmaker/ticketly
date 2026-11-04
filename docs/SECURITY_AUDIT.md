# Ticketly Security Audit

**Date:** 2026-10-01  
**Scope:** Full monorepo (`apps/web`, `apps/mobile`, `apps/api`, `packages/*`)  
**Assumption:** Active attacker targeting free tickets, oversale, cross-tenant access, webhook forgery, QR reuse, offline abuse.

Status legend (post-hardening):

- **FIXED** — remediated in this phase
- **ACCEPTED RISK** — documented, mitigated, residual risk accepted for now
- **REQUIRES BUSINESS DECISION** — product/legal call needed
- **REQUIRES EXTERNAL PROVIDER** — Stripe/Apple/Google/infra

---

## Critical

### C1. Mock payment completion in deployable code
- **File:** `apps/web/src/app/api/payments/mock/complete/route.ts`, `apps/web/src/lib/payments/index.ts`
- **Function:** `GET` mock complete, `isStripeMockMode`
- **Problem:** `STRIPE_MOCK_MODE=true` allows anyone who knows `orderId`+`sessionId` to mark orders PAID without money. Stripe webhook also accepts unsigned bodies when mock is on.
- **Consequence:** Free tickets in any environment where mock flag is left on.
- **Fix:** Refuse mock payments unless `NODE_ENV=development` AND mock flag; never enable in production builds.
- **Status:** FIXED

### C2. Unauthenticated order page exposes QR secure tokens
- **File:** `apps/web/src/app/orders/[orderNumber]/page.tsx`
- **Function:** `OrderConfirmationPage`
- **Problem:** Sequential/guessable `orderNumber` (`TKT-2026-000001`) + public page returns full ticket `secureToken` for QR.
- **Consequence:** Ticket theft by enumerating order numbers.
- **Fix:** Per-order `accessToken`; require `?t=` (or authenticated owner) to view QR; PDF similarly gated.
- **Status:** FIXED

### C3. Webhook does not verify amount/currency vs order
- **File:** `apps/web/src/services/payment-service.ts`
- **Function:** `markOrderPaid`
- **Problem:** Paid webhook can issue tickets even if Stripe amount ≠ `order.total` or currency mismatches.
- **Consequence:** Underpayment → free/discounted tickets.
- **Fix:** Hard check amount+currency before issuing; on mismatch mark `PAYMENT_ANOMALY` and do not issue tickets.
- **Status:** FIXED

---

## High

See full audit history in git; remediations completed in prior rounds.

---

## Post-fix summary

| Finding | Outcome |
|---------|--------|
| C1–C3 | FIXED |
| H1–H7 | FIXED |
| M1–M5 | FIXED |
| M6, L1–L2 | ACCEPTED RISK |
| L3 | REQUIRES BUSINESS DECISION |
| Wallet/APNs production certs | REQUIRES EXTERNAL PROVIDER |

---

## Runde 2 (2026-11)

| # | Punkt | Status |
|---|-------|--------|
| 1 | Admin webhooks GET + system/health (+ payments/health) SUPER_ADMIN | FIXED |
| 2 | `rateLimitAsync` everywhere; Memory expire + max keys | FIXED |
| 3 | Credentials authorize rate limit IP + email | FIXED |
| 4 | `markOrderPaid` requires amount+currency; webhook fetch; else `AMOUNT_MISSING` | FIXED |
| 5 | `ticketSelectionSchema` max(20); merge duplicates; min/max on sum | FIXED |
| 6 | `getBySlug` null for HIDDEN; reserve rejects HIDDEN / `isVisible=false` | FIXED |
| 7 | Promo `usedCount` release + `Order.promoReleasedAt` migration | FIXED |
| 8 | Scanner device required for mobile/offline; web cookie optional | FIXED |
| 9 | reports/search/waitlist use `jsonError` | FIXED |
| 10 | `sanitizeSpreadsheetCell` for CSV/XLSX exports | FIXED |
| 11 | Waitlist zod + rate limit + visibility + ticketType ownership | FIXED |
| 12 | `safeEqual` for CRON_SECRET + Nexi webhook auth | FIXED |
| 13 | Delete `verifyMobileToken`; `AUTH_SECRET` length gate | FIXED |
| 14 | Mock complete: sessionId match + relative redirects | FIXED |
| 15 | `scripts/backfill-ticket-token-cipher.ts` dry-run/idempotent + docs | FIXED |
| 16 | `.github/workflows/cron.yml` + LAUNCH_CHECKLIST secrets | FIXED |
