# Vercel Deployment

Deploy **`apps/web`** as a **normal** Next.js monorepo project on Vercel.

PostgreSQL remains the source of truth for money/inventory. Use **Upstash Redis** (Vercel Marketplace) for rate limiting — **do not use Vercel KV** (sunset).

## Architecture (do not change)

| Fact | Decision |
|------|----------|
| Public app | `apps/web` (Next.js) |
| Public HTTP API | Next.js route handlers under `apps/web/src/app/api/*` |
| `/api/*` traffic | Handled by **Next.js** — auth, checkout, payments, Stripe/Nexi webhooks, scanner, orders, tickets, mobile, admin, analytics, waitlist, promos, health/ready |
| `apps/api` | **Not deployed** (optional standalone Hono host for a future split) |
| `apps/mobile` | **Not a Vercel service** (Expo/EAS later) |
| Vercel Services mode | **Not used** |
| Service bindings | **None** |
| Root container | **Not used** |

`apps/web/vercel.json` stays minimal (`framework: nextjs` only). Do **not** add a services-mode `vercel.json` that routes `/api/*` to Hono or a root container.

## Project settings

| Setting | Value |
|---------|--------|
| Framework Preset | Next.js |
| Root Directory | `apps/web` |
| Install Command | `cd ../.. && npm install --legacy-peer-deps` |
| Build Command | `cd ../.. && npm run db:generate && npm run build -w @ticketly/web` |
| Output | Next default (`.next`) |
| Node | 22.x |
| Git branch (first Preview) | `cursor/eventbrite-parity-9546` |

Create two Vercel environments:

1. **Production** — live domain, **Nexi production** keys (long-term primary), production DB  
2. **Preview** — staging subdomain, **dedicated staging Postgres**, **Stripe TEST** for first Preview E2E  

Preview must not use live credentials.

---

## Preview environment variables (Stripe TEST)

Set these on the Vercel project for the **Preview** environment. Do not commit secrets.

### Required

| Variable | Preview value |
|----------|----------------|
| `DATABASE_URL` | Dedicated **staging** PostgreSQL URL |
| `AUTH_SECRET` | `openssl rand -base64 32` — ≥32 chars |
| `APP_URL` | Preview HTTPS origin, no trailing slash (update after first Preview URL is known) |
| `NEXT_PUBLIC_APP_URL` | Same as `APP_URL` |
| `PAYMENT_PROVIDER` | `stripe` |
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from Stripe **test** endpoint for this Preview URL |
| `STRIPE_MOCK_MODE` | `false` |

### Strongly recommended

| Variable | Notes |
|----------|--------|
| `TICKET_TOKEN_SECRET` | ≥16 chars (falls back to `AUTH_SECRET` if unset) |
| `OFFLINE_BUNDLE_SECRET` | ≥16 chars; offline scanner bundles |
| `EMAIL_PROVIDER` | `console` for Preview |
| `EMAIL_FROM` | e.g. `noreply@yourdomain.no` |
| `CRON_SECRET` | Required if Vercel Cron calls `/api/cron/reminders` |
| `AUTH_URL` | Optional Auth.js; set to `APP_URL` if callbacks fail |
| `ALLOW_STRIPE_TEST_IN_PROD` | `true` on Preview to silence test-key warnings (`NODE_ENV=production` on Vercel) |

### Optional

| Variable | Notes |
|----------|--------|
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL; in-memory rate limit if unset |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for event images |
| `RESERVATION_TTL_MINUTES` | Default `10` |
| `PAYMENT_GRACE_MINUTES` | Default `15` |
| `TERMS_VERSION` | e.g. `2026-10` |
| `FORCE_ENV_VALIDATE` | `true` to enforce env schema outside production |

### Nexi during Stripe Preview

Leave **unset** while `PAYMENT_PROVIDER=stripe`:

- `NEXI_ENVIRONMENT`
- `NEXI_SECRET_API_KEY`
- `NEXI_CHECKOUT_KEY`
- `NEXI_WEBHOOK_SECRET`
- `NEXI_MERCHANT_ID`
- `NEXT_PUBLIC_NEXI_CHECKOUT_KEY`

Do **not** set `PAYMENT_PROVIDER=nexi` on Preview without real Nexi test keys — startup validation will fail.

### Production (Nexi primary) — for later go-live

| Variable | Production |
|----------|------------|
| `PAYMENT_PROVIDER` | `nexi` |
| `NEXI_ENVIRONMENT` | `production` |
| `NEXI_SECRET_API_KEY` | Live secret API key |
| `NEXI_CHECKOUT_KEY` | Live checkout key |
| `NEXI_WEBHOOK_SECRET` | 8–64 char shared secret |
| `NEXI_MERCHANT_ID` | If required by agreement |
| `STRIPE_*` | Only if Stripe fallback is configured |

Never default to `PAYMENT_PROVIDER=mock` or `STRIPE_MOCK_MODE=true` in production.

---

## Stripe Preview webhook configuration

1. Deploy Preview for branch `cursor/eventbrite-parity-9546`.  
2. Copy the Preview HTTPS origin into `APP_URL` and `NEXT_PUBLIC_APP_URL` (redeploy if needed).  
3. In Stripe Dashboard (**Test mode**) → Developers → Webhooks → Add endpoint:  
   - URL: `https://<preview-host>/api/payments/stripe/webhook`  
   - Events: at least `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded` (match what the app handles)  
4. Copy the endpoint signing secret into Preview `STRIPE_WEBHOOK_SECRET`.  
5. Path must remain **`/api/payments/stripe/webhook`** (Next.js route — do not rewrite).

Nexi webhook (later): `POST {APP_URL}/api/payments/nexi/webhook`  
Auth routes: `{APP_URL}/api/auth/*`

---

## Database migrations (staging / Preview)

Use a **dedicated staging PostgreSQL** database. Never point Preview at production.

From the monorepo root on a machine/CI with network access to staging:

```bash
export DATABASE_URL="postgresql://…staging…"
npm run db:migrate
# → prisma migrate deploy (additive only)
```

- **Do not** run `npm run db:reset` / `prisma migrate reset`.  
- Optional seed **only** on an empty staging DB — never seed production with demo events.  
- Prisma client generation runs during the Vercel build (`db:generate`); migrations are **not** run inside the Vercel build by default — run `migrate deploy` against staging before or as part of ops setup.

---

## Health / readiness verification

After Preview is live:

1. `GET {APP_URL}/api/health` → healthy / ok payload  
2. `GET {APP_URL}/api/ready` → database reachable  

Then run the Stripe Preview E2E:

Event → select ticket → checkout → Stripe test payment → public Stripe webhook → order paid → ticket generated once → QR visible → admin counters update → scanner accepts once → scanner rejects duplicate → refund → refunded QR rejected.

Additional smoke:

3. Admin login → create/publish event  
4. Pause sales → new reserve fails  
5. Admin → Webhooks shows Stripe events  
6. Refund one test order → scanner rejects QR  

---

## Monorepo build notes

- Install and build must run from the **repo root** via `cd ../..` so workspace packages resolve (`@ticketly/database`, `@ticketly/auth`, `@ticketly/ticketing`, `@ticketly/payments`, `@ticketly/notifications`, `@ticketly/wallet`, `@ticketly/ui`, `@ticketly/validation`, `@ticketly/shared-types`).  
- `next.config.ts` sets `outputFileTracingRoot` to the monorepo root and `transpilePackages` for those workspaces.  
- `apps/api` is not a build dependency of `@ticketly/web`.  
- Production long-term: `PAYMENT_PROVIDER=nexi`. First Preview E2E: `PAYMENT_PROVIDER=stripe` + Stripe TEST.  
- Preview and production **must** use separate databases and separate PSP key sets.
