# Production Readiness Checklist

Hardening phase checklist for Ticketly. Items marked **done** are implemented/tested in-repo; remaining items need ops/business action before go-live.

## Authentication

- [x] Session cookies via Auth.js (HttpOnly)
- [x] Mobile sessions revocable (`MobileSession` + logout)
- [x] Login rate limiting
- [x] Disabled users rejected on mobile session validate
- [ ] Password reset / email verification — **REQUIRES BUSINESS DECISION**
- [ ] Production `AUTH_SECRET` ≥ 32 chars in secret manager

## Authorization

- [x] RBAC helpers (`canManageEvents`, `canScanTickets`, …)
- [x] `assertCanAccessOrder` / org resource helpers — never trust client `organizationId`
- [x] IDOR tests for cross-org order access
- [x] Role escalation: membership role only changeable via authorized admin flows (no self-grant SUPER_ADMIN in APIs)

## Payments

- [x] Server-side pricing only (client price fields rejected)
- [x] Mock payments blocked when `NODE_ENV=production`
- [x] Stripe webhook signature required outside mock
- [x] Webhook idempotency (`WebhookEvent` unique)
- [x] Amount + currency verification before ticket issue
- [x] Payment anomaly flag + audit on mismatch
- [ ] Staging uses Stripe **test** keys only
- [ ] Production webhook endpoint + `STRIPE_WEBHOOK_SECRET` configured

## Ticketing

- [x] Reservation `FOR UPDATE` locking
- [x] Concurrency tests (1-of-20, 10-of-50)
- [x] Public purchasability gate for free/guest types
- [x] Reservation vs payment grace (no release of paid/pending-in-grace)
- [x] Central ticket state machine
- [x] OrderSnapshot on paid orders

## Scanner

- [x] Atomic check-in (row lock)
- [x] Concurrent double-scan test
- [x] Refunded / cancelled / wrong event results
- [x] Device revoke enforced on check-in / offline bundle / sync

## Offline

- [x] Bundle omits PII (token hash + publicId + status + type name)
- [x] Bundle expiry + integrity checksum
- [x] Offline conflict → `OFFLINE_CONFLICT_DUPLICATE` (first wins)
- [x] Revoked device cannot download/sync

## QR / tokens

- [x] Cryptographic random tokens
- [x] `tokenHash` (SHA-256) for lookup; cipher for re-display
- [x] Order `accessToken` gates public order/PDF pages
- [x] Transfer rotates token

## GDPR

- [x] Consent records per purpose
- [x] Marketing never auto-opt-in from purchase
- [ ] DPA / retention schedule with legal — **REQUIRES BUSINESS DECISION**

## Logging

- [x] Structured API errors (`{ error: { code, message } }`)
- [x] Audit actions for refund, transfer, manual check-in, payment anomaly, login failure
- [x] Webhook/PDF routes avoid leaking stack traces
- [ ] Central log sink (Datadog/etc.) in production — ops

## Backups

- [x] Documented in [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md)
- [ ] Managed Postgres PITR enabled
- [ ] Quarterly restore drill completed

## Monitoring

- [x] `/api/health` liveness
- [x] `/api/ready` DB readiness
- [ ] Uptime checks + alert on ready failures
- [ ] Payment anomaly alert on `PAYMENT_ANOMALY` audit

## Testing

- [x] Unit tests (pricing, RBAC, tokens)
- [x] Integration: races, webhooks, QR, refunds, IDOR, snapshots
- [x] CI workflow for PR (install, typecheck, lint, test, build)
- [x] Playwright e2e smoke config + checkout/scanner scenarios (local)
- [x] k6 load profile (measure first)

## Deployment

- [x] Separate env docs (dev/staging/prod)
- [x] Security headers (CSP, frame deny, nosniff, referrer)
- [x] Docker compose for local
- [ ] No automatic production deploy from PR CI
- [ ] Explicit production deploy workflow + approvals

## Security audit closure

See [SECURITY_AUDIT.md](./SECURITY_AUDIT.md). **Critical/High** findings must be FIXED or explicitly blocked from production before go-live.

### Block production if

- Mock payments can run in production
- Webhooks accept unsigned bodies in production
- Order QR pages are enumerable without `accessToken`
- Cross-tenant admin reads are possible
- Check-in is not atomic
