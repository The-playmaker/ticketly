# Launch Status — Ticketly

Strict readiness for **real ticket sales**. Build success alone does **not** mean production is ready.

Statuses: **READY** | **PARTIAL** | **BLOCKED** | **OPTIONAL AFTER LAUNCH** | **MANUAL CONFIG REQUIRED**

Related: [EVENTBRITE_PARITY.md](./EVENTBRITE_PARITY.md) · [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) · [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)

**Internal note:** Final commercial legal review of Kjøpsvilkår / Personvern / Refusjonspolicy is recommended before live sales. Do not show this note on customer pages.

---

## Production hardening summary

| Area | Status | Notes |
|------|--------|-------|
| **LEGAL TERMS** | **READY** (copy) | `/terms` — Kjøpsvilkår with dynamic seller model; versioned via `LEGAL_VERSIONS.terms` |
| **PRIVACY** | **READY** (copy) | `/privacy` — Personvernerklæring; controller split platform vs organizer |
| **REFUND POLICY** | **READY** (copy) | `/refund-policy` — covers mind-change, cancel, move, used/transferred tickets |
| **AGE / ID** | **READY** (code) | Dynamic `{ageLimit}+ · Gyldig legitimasjon kreves`; checkout ack; scanner ID check |
| **EMAIL DELIVERY** | **BLOCKED** | Code supports `resend`; production still blocked until `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` |
| **PAYMENTS** | **PARTIAL** | Dual provider READY in code; live keys / public webhook **MANUAL CONFIG** |
| **SCANNER** | **READY** (code) | Validity → ID/age → name → type → notes; clear INVALID states |
| **TICKETS** | **READY** (code) | Once-only issue; email failure does not invalidate tickets |
| **SECURITY** | **READY** (code) | No raw QR/webhook jargon on customer UI; secrets stay server-side |
| **SUPPORT** | **READY** (code) | Order support contact from org fields; resend email rate-limited |

---

## Active production provider

| Setting | Value |
|---------|--------|
| **Active for new checkouts** | Set via `PAYMENT_PROVIDER` |
| Recommended first sales (while Nexi onboards) | `PAYMENT_PROVIDER=stripe` |
| Long-term primary target | `PAYMENT_PROVIDER=nexi` |

---

## Capability report

| Area | Status | Notes |
|------|--------|-------|
| **PAYMENTS** | **PARTIAL** | Dual provider architecture READY. Live keys & public webhook required. |
| **PROMO** | **READY** | Backend + admin |
| **WAITLIST** | **READY** | Join / invite / claim |
| **BUNDLES** | **PARTIAL** | `admissionCount` / `isBundle` |
| **REMINDERS** | **PARTIAL** | Cron jobs; ESP delivery optional |
| **EXPORTS** | **READY** | CSV/XLSX |
| **SUPPORT** | **READY** | Org search + order detail |
| **EVENT SERIES** | **PARTIAL** | Model + duplicate |

---

## By area (platform)

| Area | Status | Notes |
|------|--------|-------|
| **Database** | **READY** | Migrations include Eventbrite parity |
| **Auth** | **MANUAL CONFIG REQUIRED** | Production `AUTH_SECRET` |
| **Webhook (public HTTPS)** | **BLOCKED** until Preview/Production URL + provider endpoint configured |
| **Email** | **BLOCKED** | `EMAIL_PROVIDER=console` forbidden for launch; use Resend |
| **Ticket issuing** | **READY** | Independent of email success |
| **QR / Scanner** | **READY** (code) | Age/ID hierarchy on success |
| **Refund** | **READY** (code) | Uses stored payment.provider |
| **Vercel** | **MANUAL CONFIG REQUIRED** | Root `apps/web`; Preview env + staging DB |

---

## Do not mark PRODUCTION LAUNCH READY if

- Real email provider not configured (`EMAIL_PROVIDER=console`)
- Payment provider account not live-enabled / webhooks not public
- Legal seller fields missing on organizations that sell
- `/terms`, `/privacy`, `/refund-policy` missing (now present)
- Database migrations pending on staging/production
- Staging/production webhook secrets unset

---

## Absolute rules

- No mid-payment provider switch
- Redirect ≠ paid
- Mock payments forbidden in production
- Email failure must not invalidate paid tickets
- Do not hardcode seller company names globally
