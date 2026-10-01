# Ticketly Production Hardening — Security Audit

**Scope:** Monorepo at `/workspace` (primarily `apps/web`, `packages/ticketing`, `packages/database`, `apps/mobile`)  
**Method:** Static code review of checkout, payments, reservations, check-in, auth, offline scanner, and related APIs  
**Date:** 2026-10-01

---

## Executive summary

Server-side pricing for checkout is correctly authoritative (client does not send totals). Reservation locking via `FOR UPDATE` is sound for concurrent holds. Several production-critical gaps remain: **mock Stripe can mark orders paid without money**, **order/ticket QR pages are unauthenticated and order numbers are sequential**, **webhook amounts are not matched to order totals**, **device revoke is modeled but never enforced**, and **mobile bearer tokens cannot be revoked**.

| Severity | Count |
|----------|------:|
| Critical | 2 |
| High     | 7 |
| Medium   | 12 |
| Low      | 6 |
| Info     | 5 |

---

## Findings by area

### 1. Checkout / order creation — client price / where pricing is calculated

#### Finding 1.1 — Server-side pricing is authoritative (Info)

| Field | Detail |
|-------|--------|
| **Severity** | Info |
| **File** | `apps/web/src/app/api/checkout/route.ts` → `POST`; `apps/web/src/services/order-service.ts` → `OrderService.createPendingOrder`, `calculatePricing`; `apps/web/src/components/checkout/checkout-form.tsx` → `pay` |
| **Problem** | Client POST body is validated to `eventId`, `sessionId`, `items[{ticketTypeId,quantity}]`, and contact fields only (`bodySchema` in checkout route). No `price` / `total` fields are accepted. `CheckoutForm.pay` sends the same shape. Totals are computed in `calculatePricing` from DB ticket types, tiers (`resolveUnitPrice`), org/event service fees, and promo. |
| **Consequence** | Clients cannot directly forge a lower checkout total via request body. |
| **Recommended fix** | Keep this pattern. Additionally reject purchases of non-sellable types (see Finding 1.2). |

#### Finding 1.2 — Hidden / out-of-window ticket types purchasable by ID (High)

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **File** | `apps/web/src/services/reservation-service.ts` → `ReservationService.reserve`; `apps/web/src/services/order-service.ts` → `createPendingOrder`; `apps/web/src/services/event-service.ts` → `listPublic` / `getBySlug` |
| **Problem** | UI listing filters `isVisible: true`, but `reserve` / checkout only verify ticket type exists and belongs to the event. No checks for `TicketType.isVisible`, `salesStartAt` / `salesEndAt`, or event `salesStartAt` / `salesEndAt`. |
| **Consequence** | Anyone who learns a hidden `ticketTypeId` (leaked admin URL, seed, reports export) can reserve and purchase it via `/api/checkout/reserve` and `/api/checkout`. |
| **Recommended fix** | In `reserve` / `createPendingOrder`, reject types where `!isVisible` or outside sales window; also enforce event sales windows and published status. |

---

### 2. ReservationService — locking, expiration race with payment

#### Finding 2.1 — Row locking on reserve is correct (Info)

| Field | Detail |
|-------|--------|
| **Severity** | Info |
| **File** | `apps/web/src/services/reservation-service.ts` → `ReservationService.reserve` |
| **Problem** | Uses `SELECT … FROM "TicketType" … FOR UPDATE` inside `prisma.$transaction` before incrementing `quantityReserved`. Integration test `prevents two concurrent reservations of the last ticket` covers this. |
| **Consequence** | Concurrent oversell on the reservation step is mitigated for a single DB. |
| **Recommended fix** | Retain; ensure production Postgres isolation and that all inventory mutations take the same lock path. |

#### Finding 2.2 — CONVERTED reservations never expire; unpaid orders lock inventory (High)

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **File** | `apps/web/src/services/reservation-service.ts` → `releaseExpired`, `convertToOrder`; `apps/web/src/services/order-service.ts` → `createPendingOrder`; `apps/web/src/services/ticket-service.ts` → `issueTicketsForPaidOrder` |
| **Problem** | `createPendingOrder` reserves then immediately marks reservations `CONVERTED`. `releaseExpired` only selects `status: ACTIVE`. `quantityReserved` is only decremented on expire/release of ACTIVE holds or when tickets are issued. There is no job/path to cancel abandoned `PENDING` orders and free reserved quantity. |
| **Consequence** | Abandoned checkouts permanently reduce availability (inventory DoS / artificial sell-out). Payment completing after TTL is OK for the buyer (hold persists), but ops cannot reclaim stock. |
| **Recommended fix** | Add unpaid-order TTL: if `paymentStatus=PENDING` past N minutes, release `quantityReserved`, mark reservations `EXPIRED`/`RELEASED`, cancel order. Optionally keep ACTIVE until payment starts, then extend TTL tied to the order. |

#### Finding 2.3 — Promo `usedCount` not concurrency-safe (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/services/order-service.ts` → `createPendingOrder`, `applyPromo` |
| **Problem** | `applyPromo` checks `usedCount >= maxUses` in memory; then `usedCount: { increment: 1 }` without locking the promo row or a conditional update. |
| **Consequence** | Parallel checkouts can exceed `maxUses`. |
| **Recommended fix** | `UPDATE … SET usedCount = usedCount + 1 WHERE id = ? AND (maxUses IS NULL OR usedCount < maxUses) RETURNING *` and abort if no row. |

---

### 3. PaymentService webhook — signature, amount matching, idempotency

#### Finding 3.1 — Stripe signature verification present in live mode (Info)

| Field | Detail |
|-------|--------|
| **Severity** | Info |
| **File** | `apps/web/src/lib/payments/stripe-provider.ts` → `StripePaymentProvider.parseWebhook`; `apps/web/src/app/api/payments/stripe/webhook/route.ts` → `POST` |
| **Problem** | Live path calls `stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)` and requires secret + signature. |
| **Consequence** | Forged Stripe events are rejected when mock mode is off and secrets are set. |
| **Recommended fix** | Fail closed if `STRIPE_WEBHOOK_SECRET` missing in production (`NODE_ENV=production`). |

#### Finding 3.2 — Webhook / `markOrderPaid` does not verify amount vs `order.total` (High)

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **File** | `apps/web/src/services/payment-service.ts` → `handleProviderWebhook`, `markOrderPaid` |
| **Problem** | `parsed.amount` is passed into `markOrderPaid` and stored on Payment create, but never compared to `order.total`. Underpayment (misconfigured session, future order mutation, provider bug) still marks `PAID` and issues tickets. |
| **Consequence** | Tickets can be issued for less than the order total. |
| **Recommended fix** | Reject (or quarantine) when `amount != null && amount !== order.total` (and currency mismatch). Log and alert. |

#### Finding 3.3 — Webhook idempotency via unique constraint (Info)

| Field | Detail |
|-------|--------|
| **Severity** | Info |
| **File** | `apps/web/src/services/payment-service.ts` → `handleProviderWebhook`; schema `WebhookEvent` `@@unique([provider, eventId])` |
| **Problem** | Inserts `webhookEvent` first; duplicate key → `{ duplicate: true }`. `markOrderPaid` also short-circuits if already `PAID`. Covered by integration test. |
| **Consequence** | Duplicate Stripe deliveries are largely safe. |
| **Recommended fix** | Prefer insert-then-process inside one transaction, or mark `processedAt` only after successful `markOrderPaid`, so a crash after insert does not permanently skip payment. Currently `processedAt` is set on insert before handling — a crash after insert leaves the event “consumed” without payment (**Medium** operational risk; see 3.4). |

#### Finding 3.4 — Idempotency record written before payment side effects (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/services/payment-service.ts` → `handleProviderWebhook` |
| **Problem** | `webhookEvent.create` with `processedAt: new Date()` runs before `markOrderPaid`. On process failure after insert, retries return `duplicate: true` and skip work. |
| **Consequence** | Customer paid at Stripe but never gets tickets until manual repair. |
| **Recommended fix** | Two-phase: store raw event as unprocessed; process; then set `processedAt`. Allow redrive of unprocessed events. |

---

### 4. Mock Stripe mode — production abuse

#### Finding 4.1 — `STRIPE_MOCK_MODE=true` allows unpaid order completion (Critical)

| Field | Detail |
|-------|--------|
| **Severity** | Critical |
| **File** | `apps/web/src/lib/payments/index.ts` → `isStripeMockMode`, `getPaymentProvider`; `apps/web/src/app/api/payments/mock/complete/route.ts` → `GET`; `apps/web/src/lib/payments/mock-stripe-provider.ts` → `createCheckout`, `parseWebhook`; `apps/web/src/app/api/payments/stripe/webhook/route.ts` → `POST`; `.env.example` |
| **Problem** | When `STRIPE_MOCK_MODE === "true"`: checkout URLs point at `/api/payments/mock/complete`, which marks the order paid via webhook with `signature: "mock"`; Stripe webhook route accepts unsigned bodies; mock `parseWebhook` trusts JSON `orderId` / `amount` with no crypto verification. `.env.example` defaults `STRIPE_MOCK_MODE="true"`. |
| **Consequence** | Anyone who can hit the API can complete arbitrary unpaid orders and receive valid tickets. |
| **Recommended fix** | Hard-disable mock routes unless `NODE_ENV !== "production"` **and** explicit allowlist. Default `.env.example` to `false`. Startup assert: refuse boot in production if mock mode is on. |

---

### 5. Check-in / QR tokens — hashing, sequential IDs

#### Finding 5.1 — QR tokens are high-entropy; not hashed at rest (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/lib/tickets/token.ts` → `generateSecureToken`, `buildQrPayload`; `apps/web/src/services/ticket-service.ts` → `issueTicketsForPaidOrder`; `packages/database/prisma/schema.prisma` → `Ticket.secureToken`; `apps/web/src/services/check-in-service.ts` → `checkInByToken` |
| **Problem** | Tokens are `randomBytes(32)` base64url (good). Stored and looked up as plaintext `secureToken` (`WHERE "secureToken" = ${input.token}`). Offline bundles correctly store `sha256` hashes via `hashTicketToken`. |
| **Consequence** | DB dump / backup leak yields immediately usable QR payloads for all tickets. |
| **Recommended fix** | Store only `tokenHash` server-side; issue raw token once (email/PDF/wallet). Online check-in hashes the presented token before lookup. |

#### Finding 5.2 — Public ticket IDs are random, not sequential (Info)

| Field | Detail |
|-------|--------|
| **Severity** | Info |
| **File** | `apps/web/src/lib/tickets/token.ts` → `generatePublicTicketId` |
| **Problem** | Format `TKT-` + 6 chars from 32-symbol alphabet via `randomBytes` — not a DB sequence. |
| **Consequence** | Public IDs are not trivially enumerable like `1,2,3`, though space is finite (~1e9). |
| **Recommended fix** | Still require auth or signed links for PDF/API access (Finding 6.2). |

#### Finding 5.3 — Order numbers are sequential and guessable (Critical) — see also §6

| Field | Detail |
|-------|--------|
| **Severity** | Critical |
| **File** | `apps/web/src/lib/orders/order-number.ts` → `generateOrderNumber`; `apps/web/src/app/orders/[orderNumber]/page.tsx`; `apps/web/src/services/order-service.ts` → `getByOrderNumber` |
| **Problem** | Order numbers are `TKT-{year}-{counter padded to 6}` from `OrderSequence`. Confirmation page is unauthenticated and renders full QR `secureToken`s for paid orders. |
| **Consequence** | Enumerating `TKT-2026-000001…` harvests valid entry QR codes (ticket theft). |
| **Recommended fix** | Require email magic link / session ownership / unguessable order access token in the URL. Stop embedding raw QR secrets on public pages. Use non-sequential order references for URLs. |

---

### 6. Admin / API authorization — IDOR, organization isolation

#### Finding 6.1 — Admin event dashboard enforces org RBAC (Info)

| Field | Detail |
|-------|--------|
| **Severity** | Info |
| **File** | `apps/web/src/app/admin/events/[id]/page.tsx`; `apps/web/src/app/api/admin/reports/route.ts` → `GET`; `apps/web/src/lib/auth/rbac.ts` → `canManageEvents`, `canScanTickets` |
| **Problem** | Event admin and reports load event, then `canManageEvents(user, event.organizationId)`. Check-in/search similarly gate on org role. |
| **Consequence** | Cross-org event IDOR on these paths is blocked for non–super-admins. |
| **Recommended fix** | Apply the same pattern to every future admin mutation API. |

#### Finding 6.2 — Unauthenticated ticket PDF by `publicId` (High)

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **File** | `apps/web/src/app/api/tickets/[publicId]/pdf/route.ts` → `GET` |
| **Problem** | No session/auth. Fetches ticket by `publicId` and embeds QR from `secureToken` in the PDF. |
| **Consequence** | Knowledge (or brute force) of `publicId` yields a usable ticket PDF. |
| **Recommended fix** | Require owner session, signed short-lived download token, or order-access secret. Rate-limit aggressively. |

#### Finding 6.3 — JWT memberships stale after role revoke (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/lib/auth/index.ts` → `jwt` / `session` callbacks; `apps/web/src/lib/auth/session.ts` → `requireSession` |
| **Problem** | Memberships and `globalRole` are copied into JWT at login; refreshed only on `trigger === "update"`. Session `maxAge` is 7 days. `requireSession` hardcodes `isActive: true` from session presence. |
| **Consequence** | Demoted/deactivated staff retain admin/scan rights until JWT expires. |
| **Recommended fix** | Re-load user + memberships from DB on each request for privileged routes, or short-lived access tokens + refresh with revocation checks. |

#### Finding 6.4 — `canRefund` always true for organizer admins (Low)

| Field | Detail |
|-------|--------|
| **Severity** | Low |
| **File** | `apps/web/src/lib/auth/rbac.ts` → `canRefund` |
| **Problem** | `if (m.role === OrgRole.ORGANIZER_ADMIN) return m.canRefund \|\| true;` — `\|\| true` makes the flag meaningless. |
| **Consequence** | Org cannot deny refund capability to admins via `canRefund`. |
| **Recommended fix** | `return m.canRefund` (or explicit admin default without `\|\| true`). |

---

### 7. Mobile auth bearer tokens — revocation

#### Finding 7.1 — Stateless HMAC tokens; no revoke/denylist (High)

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **File** | `apps/web/src/app/api/mobile/auth/login/route.ts` → `signMobileToken`, `verifyMobileToken` |
| **Problem** | Token is `base64url(JSON:{sub,exp}).HMAC-SHA256` with 7-day `exp`. No `jti`, no server-side session store, no logout invalidation. Stolen token works until expiry. Fallback secret is `"dev"` if `AUTH_SECRET` unset. |
| **Consequence** | Compromised staff device / token theft cannot be remotely invalidated; missing secret in misconfig yields forgeable tokens. |
| **Recommended fix** | Persist sessions (`MobileSession` with hash + `revokedAt`); check on each request; rotate on logout/password change; require `AUTH_SECRET` at boot; consider binding to device id. |

---

### 8. Rate limiting implementation

#### Finding 8.1 — In-memory limiter; spoofable client IP (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/lib/security/rate-limit.ts` → `rateLimit`, `clientIp`; used by checkout, reserve, promo, mobile login, check-in |
| **Problem** | Process-local `Map` buckets (documented as single-instance). `clientIp` trusts first `x-forwarded-for` hop. No Redis/shared store. |
| **Consequence** | Multi-instance deploys dilute limits; attackers can rotate spoofed XFF if the edge does not overwrite it; login/checkout abuse scales. |
| **Recommended fix** | Redis/Upstash limiter; take IP only from trusted proxy; fail closed on missing infra in production for auth endpoints. |

---

### 9. Secrets in repo / `.env.example`

#### Finding 9.1 — `.env` gitignored; example contains placeholders (Low)

| Field | Detail |
|-------|--------|
| **Severity** | Low |
| **File** | `.gitignore` (ignores `.env`); `.env.example`; local `.env` (not tracked) |
| **Problem** | `.env` is ignored (good). `.env.example` documents required vars but sets `STRIPE_MOCK_MODE="true"` and placeholder Stripe keys — easy to copy into prod unsafely. `AUTH_SECRET` / `OFFLINE_BUNDLE_SECRET` are placeholders. |
| **Consequence** | Operational misconfiguration more than secret leakage from git history of `.env` (current tree ignores it). |
| **Recommended fix** | Example values: `STRIPE_MOCK_MODE=false`, empty secrets with comments; CI check that production env forbids mock mode and placeholder keys. |

---

### 10. Free / guest tickets publicly purchasable?

#### Finding 10.1 — Zero-total orders auto-complete without payment (High)

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **File** | `apps/web/src/services/payment-service.ts` → `startCheckout` (`if (order.total === 0)` → `markOrderPaid`); `apps/web/src/services/order-service.ts` → `calculatePricing` |
| **Problem** | Any ticket type with `price: 0` (or promo reducing total to 0) immediately issues paid tickets via public `/api/checkout`. Guest list (`GuestListEntry`) is separate and not sold through this path, but “guest/comp” style free ticket types are public checkout. |
| **Consequence** | Unlimited free ticket farming unless quantity/sales rules constrain stock; comps intended for invite-only become public. |
| **Recommended fix** | Require auth, invite/promo claim, or staff issuance for `price === 0`; never expose free types as `isVisible` public sellable without caps and anti-abuse. |

---

### 11. Refund service consistency

#### Finding 11.1 — Provider refund before DB txn; flat per-ticket amount (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/services/refund-service.ts` → `refundOrder` |
| **Problem** | (1) Calls `provider.refund` before the DB transaction that marks tickets refunded — provider success + DB failure = money returned but ticket still VALID. (2) Partial refunds use `Math.round(order.total / order.tickets.length)` ignoring mixed ticket prices / fees. (3) No org authorization inside the service (caller must enforce; only wired from `EventService.cancel` in-repo — no dedicated refund HTTP route found). |
| **Consequence** | Inconsistent money vs ticket state; unfair partial refunds; future API must not call this without RBAC. |
| **Recommended fix** | Saga with compensating actions or outbox; compute refund from order line/`unitPrice`; enforce `canRefund` at API boundary; idempotent refund keys already partially present — keep them. |

---

### 12. Ticket transfer token invalidation

#### Finding 12.1 — Online token rotated; old/new tokens stored plaintext (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/services/ticket-service.ts` → `transferTicket`; schema `TicketTransfer.oldToken` / `newToken` |
| **Problem** | Transfer replaces `secureToken` with `generateSecureToken(32)` — old QR fails online check-in (good). Both old and new tokens are stored plaintext on `TicketTransfer`. No HTTP route currently exposes transfer (service + validator only). Offline bundles retain old `tokenHash` until refresh — transferred tickets may scan offline as VALID with **old** QR until bundle refresh, or fail with new QR until refresh. |
| **Consequence** | DB leak of transfer history recovers QR secrets; offline window allows stale validation. |
| **Recommended fix** | Store hashes only on transfer audit rows; invalidate/rebuild offline bundles on transfer; document staff refresh requirement. |

---

### 13. Offline scanner bundle contents and device revoke

#### Finding 13.1 — Bundle minimizes PII; returns hashes to device (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `packages/ticketing/src/offline.ts` → `OfflineScannerService.createBundle`; `apps/web/src/app/api/scanner/offline/bundle/route.ts` → `GET`; `docs/OFFLINE_SCANNER.md` |
| **Problem** | Encrypted payload contains `publicId`, `tokenHash`, `status`, `ticketTypeName` (no names/emails — good). API also returns decrypted `entries` over TLS to staff. Mobile stores bundle in AsyncStorage (`apps/mobile/lib/offline-scanner.ts`). |
| **Consequence** | Stolen staff device yields all event token hashes (offline forgery of check-in attempts / enumeration). Documented limitations on stale refunds/sales are accurate. |
| **Recommended fix** | Prefer encrypted-at-rest on device (SecureStore/Keystore); shorter TTL; remote wipe tied to device revoke (Finding 13.2). |

#### Finding 13.2 — `Device.revokedAt` unused; sync accepts free-form `deviceId` (High)

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **File** | `packages/database/prisma/schema.prisma` → `Device.revokedAt`; `packages/auth/src/index.ts` → `canManageDevices`; `apps/web/src/app/api/scanner/offline/sync/route.ts`; `apps/mobile/app/staff/scanner.tsx` (`device_${Platform.OS}_${Date.now()}`) |
| **Problem** | Schema supports device revoke; `canManageDevices` exists; no `prisma.device` usage in apps. Offline sync/`deviceId` is an unchecked string, not validated against `Device` or `revokedAt`. |
| **Consequence** | Lost/stolen scanner cannot be revoked; attacker with a staff bearer token syncs from any fabricated device id. |
| **Recommended fix** | Register devices, bind tokens to `deviceId`, reject sync/check-in when `revokedAt != null`, admin revoke UI. |

---

### 14. Raw SQL usage

#### Finding 14.1 — Parameterized `$queryRaw` for locking (Low)

| Field | Detail |
|-------|--------|
| **Severity** | Low |
| **File** | `reservation-service.ts` `reserve`; `check-in-service.ts` `checkInByToken`; `ticket-service.ts` `issueTicketsForPaidOrder`; `packages/ticketing/src/offline.ts` `syncCheckIns` |
| **Problem** | All uses are Prisma tagged templates with bound parameters (not string-concatenated SQL). Purpose is `FOR UPDATE` row locks. |
| **Consequence** | Low injection risk with current patterns; future string-built SQL would be dangerous. |
| **Recommended fix** | Lint/ban `$queryRawUnsafe` / non-tagged raw SQL; keep locks. |

---

### 15. Error handling leaking internals

#### Finding 15.1 — API routes return `e.message` to clients (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/app/api/checkout/route.ts`; `reserve/route.ts`; `payments/stripe/webhook/route.ts`; `admin/reports/route.ts`; `tickets/search/route.ts`; `tickets/check-in/route.ts` |
| **Problem** | Catch blocks return `{ error: e instanceof Error ? e.message : … }`. Domain throws are Norwegian user strings (OK), but unexpected Prisma/provider errors can leak schema/internal details. Webhook returns error text to Stripe sender. |
| **Consequence** | Information disclosure aiding attackers; noisy webhook retries. |
| **Recommended fix** | Map known domain errors to stable codes; log full error server-side; generic client message for unknowns. |

---

### 16. Auth session cookies / CSRF

#### Finding 16.1 — Auth.js JWT cookies; middleware does not set cookie flags (Medium)

| Field | Detail |
|-------|--------|
| **Severity** | Medium |
| **File** | `apps/web/src/lib/auth/index.ts` → `NextAuth({ session: { strategy: "jwt", maxAge: 7d }, trustHost: true })`; `apps/web/src/middleware.ts` |
| **Problem** | Relies on Auth.js defaults for `httpOnly` / `SameSite` (typically Lax + httpOnly). Middleware only adds HSTS in production; comment claims cookie hints but does not set `Secure`/`SameSite` explicitly. `trustHost: true` widens host trust. No explicit CSRF token on cookie-authenticated state-changing APIs (reports export is GET — CSRF-exfiltratable for admins). |
| **Consequence** | Cross-site GET can trigger CSV/XLSX export of PII for logged-in admins if browser sends cookies. Weak/mis-set cookies in non-HTTPS misdeploy. |
| **Recommended fix** | Explicit cookie `secure: true`, `sameSite: "lax"` (or `strict` where viable); CSRF for cookie-auth POST/mutating GET exports; avoid `trustHost` without edge controls; prefer POST+auth for exports. |

#### Finding 16.2 — Security headers present (Info)

| Field | Detail |
|-------|--------|
| **Severity** | Info |
| **File** | `apps/web/next.config.ts` → `headers`; `apps/web/src/middleware.ts` |
| **Problem** | `X-Frame-Options`, `nosniff`, Referrer-Policy, Permissions-Policy, CSP, and production HSTS are set. CSP still allows `'unsafe-inline'` / `'unsafe-eval'` for scripts. |
| **Consequence** | Baseline clickjacking/MIME protections; CSP XSS hardening is partial. |
| **Recommended fix** | Tighten CSP as Next allows; keep HSTS. |

---

## Cross-cutting positive controls

- Checkout does not trust client totals (`OrderService.calculatePricing`).
- Payment success is not based on frontend redirect alone (comments + webhook / mock-complete simulating webhook).
- Check-in uses row locks; double scan returns `ALREADY_USED`.
- Offline design documents limitations (`docs/OFFLINE_SCANNER.md`) and avoids putting PII in bundles.
- Mobile session secrets intended for SecureStore (`apps/mobile/lib/secure-store.ts`).

---

## Priority remediation order

1. **Critical:** Disable mock Stripe in production; gate `/api/payments/mock/*` and unsigned webhooks.
2. **Critical:** Stop public exposure of QR secrets via sequential `/orders/{orderNumber}` (and related PDF IDOR).
3. **High:** Match webhook `amount` to `order.total`; enforce ticket visibility/sales windows; fix free-ticket abuse; implement device revoke + mobile token revocation; auth PDF downloads.
4. **Medium:** Unpaid reservation/order expiry; webhook process-before-ack; hash tokens at rest; rate-limit store; CSRF on cookie auth exports; refund saga consistency.
5. **Low/Info:** Promo atomicity, RBAC `canRefund` bug, CSP/`queryRaw` hygiene, secret example defaults.

---

## File index (audited)

| Path | Role |
|------|------|
| `apps/web/src/app/api/checkout/route.ts` | Order + payment start |
| `apps/web/src/app/api/checkout/reserve/route.ts` | Holds |
| `apps/web/src/app/api/payments/stripe/webhook/route.ts` | Stripe webhook |
| `apps/web/src/app/api/payments/mock/complete/route.ts` | Mock pay complete |
| `apps/web/src/services/payment-service.ts` | Checkout / webhook / mark paid |
| `apps/web/src/services/reservation-service.ts` | Locks / TTL |
| `apps/web/src/services/order-service.ts` | Pricing / orders |
| `apps/web/src/services/ticket-service.ts` | Issue / transfer |
| `apps/web/src/services/check-in-service.ts` | Scan |
| `apps/web/src/services/refund-service.ts` | Refunds |
| `apps/web/src/lib/tickets/token.ts` | Token generation |
| `apps/web/src/lib/security/rate-limit.ts` | Rate limits |
| `apps/web/src/lib/auth/index.ts` | NextAuth |
| `apps/web/src/lib/auth/rbac.ts` | RBAC |
| `apps/web/src/app/api/mobile/auth/login/route.ts` | Mobile bearer |
| `packages/ticketing/src/offline.ts` | Offline bundle/sync |
| `apps/web/src/app/api/scanner/offline/bundle/route.ts` | Bundle API |
| `apps/web/src/app/api/scanner/offline/sync/route.ts` | Sync API |
| `apps/web/src/app/orders/[orderNumber]/page.tsx` | Public order + QR |
| `apps/web/src/app/api/tickets/[publicId]/pdf/route.ts` | Public PDF |
| `.env.example` | Env template |
