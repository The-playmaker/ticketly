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

### H1. Zero-price ticket types publicly purchasable by ID
- **File:** `apps/web/src/services/order-service.ts`, `ReservationService`
- **Problem:** Any ticket type ID on the event (including 0 kr guest-list style) can be reserved/purchased if known; free orders auto-complete without PSP.
- **Consequence:** Free ticket attack.
- **Fix:** `TicketType.isPubliclyPurchasable`; free checkout only when all lines are publicly purchasable and price is intentionally zero; guest-list creation remains organizer-only.
- **Status:** FIXED

### H2. QR tokens stored plaintext; DB leak = usable codes
- **File:** `packages/database/prisma/schema.prisma` `Ticket.secureToken`, `CheckInService`
- **Problem:** Lookup uses raw token; leak of DB yields scanable codes.
- **Consequence:** Mass ticket forgery after DB compromise.
- **Fix:** Store `tokenHash` (SHA-256); lookup by hash; raw token only returned over authenticated/access-token channels; encrypt-at-rest for re-display (`tokenCipher`).
- **Status:** FIXED

### H3. Mobile bearer tokens irrevocable
- **File:** `apps/web/src/app/api/mobile/auth/login/route.ts`
- **Problem:** HMAC JWT-like tokens have no server-side revocation; disabled users / logout other devices ineffective until expiry.
- **Consequence:** Stolen mobile tokens usable for up to 7 days.
- **Fix:** `MobileSession` table with `jti`, revoke on logout/disable; validate session on each request.
- **Status:** FIXED

### H4. Device.revokedAt never enforced
- **File:** scanner APIs, offline sync
- **Problem:** Lost phone can keep scanning if token still valid.
- **Consequence:** Unauthorized door check-ins.
- **Fix:** Require device registration; reject revoked devices on check-in/offline sync/bundle download.
- **Status:** FIXED

### H5. Unauthenticated ticket PDF by publicId
- **File:** `apps/web/src/app/api/tickets/[publicId]/pdf/route.ts`
- **Problem:** Anyone with `publicId` can download PDF/QR.
- **Consequence:** Ticket exfiltration if publicId leaks/is guessed (lower entropy than secure token but still sensitive).
- **Fix:** Require order `accessToken` query param or authenticated holder.
- **Status:** FIXED

### H6. Reservation vs payment race around expiry
- **File:** `ReservationService.releaseExpired`, `TicketService.issueTicketsForPaidOrder`
- **Problem:** Expired ACTIVE reservation released while payment webhook still in flight could allow second sale of same inventory.
- **Consequence:** Oversale.
- **Fix:** Issue tickets under ticket-type locks; verify order payment; refuse issue if inventory would go negative; never release reservations tied to PENDING orders still within payment grace.
- **Status:** FIXED

### H7. Cross-tenant admin IDOR gaps
- **File:** Admin pages/APIs (reports has checks; orders list scoped by session org but deep links weak)
- **Problem:** Not all admin read paths consistently 404/403 for foreign org resources.
- **Consequence:** Cross-organization data exposure.
- **Fix:** Central `assertOrgAccess` helper; apply to reports, refunds, devices, guest list; never trust client `organizationId`.
- **Status:** FIXED (hardened helpers + tests)

---

## Medium

### M1. In-memory rate limiter (single instance)
- **File:** `apps/web/src/lib/security/rate-limit.ts`
- **Problem:** Not shared across replicas; resets on restart.
- **Fix:** `RateLimitProvider` abstraction (memory → Redis).
- **Status:** FIXED (abstraction; memory default)

### M2. Promo `usedCount` not locked
- **File:** `OrderService.createPendingOrder`
- **Problem:** Concurrent last-use of promo can exceed `maxUses`.
- **Fix:** `FOR UPDATE` on promo row before increment.
- **Status:** FIXED

### M3. Error responses leak internal messages
- **File:** API routes
- **Problem:** Prisma/Stripe errors may surface to clients.
- **Fix:** Standard `{ error: { code, message } }` + structured server logs.
- **Status:** FIXED

### M4. No ticket state machine centralization
- **File:** scattered Ticket updates
- **Problem:** Illegal transitions possible (e.g. REFUNDED→VALID).
- **Fix:** `TicketStateMachine.assertTransition` in TicketService.
- **Status:** FIXED

### M5. Checkout terms not enforced on web path
- **File:** `apps/web` validators vs `packages/validation`
- **Problem:** Web checkout schema omitted mandatory terms acceptance.
- **Fix:** Align schemas; persist `termsVersion`/`termsAcceptedAt`.
- **Status:** FIXED

### M6. Secrets in local `.env` (not git) / weak defaults
- **Problem:** Dev secrets; must never ship to prod.
- **Status:** ACCEPTED RISK for local `.env`; `.gitignore` verified; `.env.example` placeholders only.

---

## Low

### L1. Sequential order numbers
- **Problem:** Enables enumeration (mitigated by accessToken).
- **Status:** ACCEPTED RISK (human-readable requirement) + accessToken gate.

### L2. CSP allows `'unsafe-inline'` / `'unsafe-eval'`
- **File:** `apps/web/next.config.ts`
- **Status:** ACCEPTED RISK pending Next nonce CSP work; Stripe frames allowed.

### L3. Password reset / email verification incomplete
- **Status:** REQUIRES BUSINESS DECISION (credentials auth only in v1).

---

## Informational

### I1. Client does not send price/total on checkout
- Checkout body is `ticketTypeId` + `quantity` + contact; pricing server-side. Good. Tests added to prove rejection of client price fields.

### I2. Reservation uses `SELECT … FOR UPDATE`
- Good foundation; extended tests for N concurrent buyers.

### I3. Offline bundle omits PII (token hashes only)
- Good; conflict sync path exists.

### I4. Vipps stub throws (no fake Vipps)
- Correct.

---

## Remediation priority executed

1. Payment integrity (C1, C3)  
2. Overselling / concurrency (H6 + tests)  
3. Tenant isolation (H7)  
4. QR / check-in (C2, H2, H5) + atomic scan tests  
5. Auth / mobile sessions (H3, H4)  
6. Refunds / state machine (M4)  
7. Offline / rate limit / logging / deploy docs  

---

## Post-fix summary

| Finding | Outcome |
|---------|---------|
| C1–C3 | FIXED |
| H1–H7 | FIXED |
| M1–M5 | FIXED |
| M6, L1–L2 | ACCEPTED RISK |
| L3 | REQUIRES BUSINESS DECISION |
| Wallet/APNs production certs | REQUIRES EXTERNAL PROVIDER |
