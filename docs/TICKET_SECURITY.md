# Ticketly Ticket Security

**Date:** 2026-10-17  
**Branch focus:** Anti-fraud & ticket security hardening  
**Production QR default:** `STATIC_QR`  
**Dynamic QR readiness:** **PARTIAL / NOT READY** for production

---

## 1. Existing security verified

| Control | Status | Evidence |
|--------|--------|----------|
| Cryptographically random 256-bit QR tokens (`generateSecureToken(32)`) | Verified | `lib/tickets/token.ts`, issuance in `TicketService` |
| Token stored as SHA-256 `tokenHash`; raw not required for validation | Verified | `CheckInService` lookup by hash |
| AES-256-GCM `tokenCipher` for re-display only | Verified | encrypt/decrypt helpers |
| Server-side status checks (VALID / CHECKED_IN / REFUNDED / CANCELLED / event cancel / wrong event) | Verified | `CheckInService.admitLockedTicket` |
| Atomic admission with `SELECT … FOR UPDATE` | Verified | check-in + offline sync |
| Concurrent scanners → one SUCCESS | Verified | `hardening.test.ts`, `ticket-security.test.ts` |
| Transfer rotates token hash; old QR invalid | Verified | `TicketService.transferTicket` + tests |
| Order/PDF gated by access token or owner session | Verified | order page, PDF route |
| Staff auth + assigned-event + device revoke on scanner APIs | Verified | `/api/tickets/check-in`, offline routes |
| Offline bundle excludes PII; conflict = first success wins | Verified | `packages/ticketing/src/offline.ts` |
| Check-in + transfer rate limits | Verified | `rateLimit` on routes |
| PDF `Cache-Control: private, no-store` | Verified | PDF route + next.config ticket paths |

---

## 2. Vulnerabilities / gaps found (this pass)

| Gap | Severity | Fix |
|-----|----------|-----|
| No dedicated ticket-security doc / offline×QR matrix | Medium | This document |
| Dynamic QR not modeled; screenshot reuse of static QR is inherent | High (product) | Foundation + flag OFF; STATIC default |
| Duplicate scan UI lacked previous device/staff | Low | Response + scanner UI |
| Manual override lacked elevated auth + required reason | Medium | `forceOverride` + `canForceCheckInOverride` |
| No organizer fraud diagnostics surface | Medium | `/admin/events/[id]/security` |
| Analytics could store `/orders/…?t=` paths | Medium | Skip/sanitize sensitive paths |
| Access-token pages used default referrer policy | Medium | `Referrer-Policy: no-referrer` on ticket routes |
| Public `/t/verify/{token}` page missing (QR pointed at it) | Low | Safe landing (no status disclosure) |
| Transfer API missing (service-only) | Medium | `/api/tickets/transfer` with auth + RL |
| Offline could theoretically hash a dynamic payload as static | High if DYN enabled | Explicit reject; bundle refused for DYNAMIC_QR events |
| PDF would embed long-lived token even if event were DYNAMIC_QR | High if DYN enabled | PDF returns 409 for DYNAMIC_QR |

---

## 3. Fixes implemented

- Schema: `TicketQrMode` (`STATIC_QR` \| `DYNAMIC_QR`), `Event.qrMode` default `STATIC_QR`, `dynamicQrTtlSeconds` default 30
- Dynamic QR credential format `dqr.v1.<claims>.<mac>` — MAC over publicId/event/exp/nonce using key derived from `tokenHash` (not raw secret)
- Mint API: holder session or order access token only — **not** mint-from-copied-QR-token
- Feature flag `ENABLE_DYNAMIC_QR` (default off)
- Check-in path for dynamic credentials (expiry, MAC, event, status, atomic lock)
- Force override with elevated role + reason + audit `CHECKIN_FORCE_OVERRIDE`
- Fraud diagnostics admin page (invalid, duplicates, revoked devices, overrides, offline conflicts)
- Privacy: analytics exclusion, referrer/cache headers, log redaction helpers
- Offline: reject dynamic payloads; refuse offline bundles for DYNAMIC_QR events
- Integration tests: forged/modified/copied/concurrent/wrong-event/transfer/cancel/revoked/dynamic expiry & replay

---

## 4. Dynamic QR readiness

| Item | Status |
|------|--------|
| Schema + mode enum | Done |
| Credential format + verification | Done |
| Mint API (authenticated, rate-limited) | Done |
| Feature flag OFF by default | Done |
| Web holder UI auto-rotate | **Not shipped** |
| Native mobile dynamic QR UI | **Not shipped** |
| Wallet (Apple/Google) dynamic | **Disabled / unsupported** |
| Offline dynamic | **Explicitly unsupported** |
| PDF dynamic | **Explicitly unsupported** |
| Full lifecycle prod soak tests | **Not done** |

**Verdict: PARTIAL / NOT READY**  
**Production default remains `STATIC_QR`.** Do not set `ENABLE_DYNAMIC_QR=true` in production until holder UIs and ops runbooks are complete.

**Honest limit:** Dynamic QR does **not** completely prevent screenshot sharing while a credential is still within its TTL and the ticket is still VALID. It does prevent long-lived reusable codes and post-check-in / post-expiry / post-transfer reuse.

---

## 5. Offline & channel matrix

| Channel | STATIC_QR | DYNAMIC_QR |
|---------|-----------|------------|
| Online web scanner | Supported | Supported only if `ENABLE_DYNAMIC_QR=true` **and** `event.qrMode=DYNAMIC_QR` |
| Online native scanner | Supported | Same as web (API path) |
| Offline native scanner | Supported (bundle of token hashes) | **Disabled** — bundle create throws; client rejects `dqr.v1` |
| Static PDF | Supported (auth required) | **Disabled** (409) |
| Web live dynamic QR UI | N/A | **Not ready** |
| Native holder dynamic QR | N/A | **Not ready** |
| Apple / Google Wallet | Stub / optional static | **Not supported** for dynamic |

---

## 6. Ownership & transfer policy

1. Transfer requires owner session or order access token; rate-limited.
2. Prior `tokenHash` / cipher rotated; old static QR and old dynamic MAC keys fail.
3. `TicketTransfer` stores **hashes** of old/new tokens (not raw secrets).
4. Audit log `TICKET_TRANSFER` without raw credentials.
5. Holder fields updated; admission history (check-ins) preserved on the same ticket row.

---

## 7. Scanner UX (Norwegian door messages)

- Success: **GYLDIG** + ticket type + holder + age + **KONTROLLER LEGITIMASJON** + access note (VIP/zone if configured on ticket type description)
- Duplicate: **ALLEREDE BRUKT** + prior time + prior device/staff when available
- Override: EVENT_MANAGER / ORGANIZER_ADMIN + reason + audit

---

## 8. Remaining launch blockers (ticket security)

1. **Do not enable `ENABLE_DYNAMIC_QR` in production** until holder rotate UI + ops docs land.
2. Wallet passes still stubbed — do not claim Wallet anti-fraud.
3. In-memory rate limiter without Upstash remains multi-instance weak (see SECURITY_AUDIT M1).
4. Legacy plaintext `Ticket.secureToken` column still accepted as fallback during migration — finish backfill and stop reading plaintext.
5. Web scanner uses device string `web-scanner` (not revocable Device row) — register web devices for full revoke coverage.

---

## 9. Test commands

```bash
npm run db:migrate
npm run test -w @ticketly/web -- tests/integration/ticket-security.test.ts
npm run typecheck
npm run lint
npm run build
```
