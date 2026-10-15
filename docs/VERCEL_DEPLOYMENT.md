# Vercel Deployment

Deploy **`apps/web`** as a Next.js project on Vercel. PostgreSQL remains the source of truth for money/inventory. Use **Upstash Redis** (Vercel Marketplace) for rate limiting — **do not use Vercel KV** (sunset).

## Project settings

| Setting | Value |
|---------|--------|
| Framework Preset | Next.js |
| Root Directory | `apps/web` |
| Install Command | `cd ../.. && npm install --legacy-peer-deps` |
| Build Command | `cd ../.. && npm run db:generate && npm run build -w @ticketly/web` |
| Output | Next default (`.next`) |
| Node | 22.x |

Create two Vercel environments:

1. **Production** — live domain, live Stripe, production DB  
2. **Preview** — staging subdomain, Stripe **test** keys, staging DB  

## Required environment variables

### Core (all envs)

| Variable | Example / notes |
|----------|-----------------|
| `DATABASE_URL` | Postgres connection string (pooled OK for serverless; use direct URL for migrations) |
| `AUTH_SECRET` | `openssl rand -base64 32` — ≥32 chars |
| `APP_URL` | `https://ticketly.no` (no trailing slash) |
| `NEXT_PUBLIC_APP_URL` | Same public URL as `APP_URL` |

### Auth.js / NextAuth

| Variable | Notes |
|----------|--------|
| `AUTH_SECRET` | Same as above |
| `AUTH_URL` | Optional; set to `APP_URL` if callbacks fail |
| Auth callback | `{APP_URL}/api/auth/callback/credentials` (and providers you enable) |

Add production + preview domains under Vercel → Project → Settings → Domains, and in any OAuth provider allowlists.

### Stripe

| Variable | Production | Preview/Staging |
|----------|------------|-----------------|
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | `pk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from **live** endpoint | `whsec_…` from **test** endpoint |
| `STRIPE_MOCK_MODE` | **`false`** | `true` only for local/demo; prefer `false` + test keys on preview |

Webhook endpoint: `POST {APP_URL}/api/payments/stripe/webhook`  
Events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`

### Ticket / offline crypto

| Variable | Notes |
|----------|--------|
| `TICKET_TOKEN_SECRET` | ≥16 chars; encrypt QR re-display |
| `OFFLINE_BUNDLE_SECRET` | ≥16 chars; offline scanner bundles |

### Redis (Upstash via Vercel Marketplace)

| Variable | Notes |
|----------|--------|
| `UPSTASH_REDIS_REST_URL` | From Upstash integration |
| `UPSTASH_REDIS_REST_TOKEN` | From Upstash integration |

If unset, in-memory rate limiting is used (OK for single instance; **not** for multi-region prod).

### Email

| Variable | Notes |
|----------|--------|
| `EMAIL_PROVIDER` | `console` \| `resend` \| `smtp` (as implemented) |
| `EMAIL_FROM` | `noreply@yourdomain.no` |
| Provider API key | e.g. `RESEND_API_KEY` if using Resend |

### Optional

| Variable | Notes |
|----------|--------|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for event images |
| `RESERVATION_TTL_MINUTES` | Default `10` |
| `PAYMENT_GRACE_MINUTES` | Default `15` |
| `TERMS_VERSION` | e.g. `2026-10` |
| `FORCE_ENV_VALIDATE` | `true` to enforce env schema in non-prod |

## Database migrations

Run against production **before** or during first deploy (from CI or ops machine):

```bash
export DATABASE_URL="postgresql://…"
npm run db:migrate
# optional seed ONLY on empty staging — never seed prod with demo events
```

## Post-deploy smoke

1. `GET /api/health` → `{ status: "ok" }`  
2. `GET /api/ready` → database ok  
3. Admin login → create event → release 50 → publish  
4. Public `/events/{slug}` → reserve → checkout (test mode) → webhook → QR  
5. Admin live feed shows sale  
6. Pause sales → new reserve fails  
7. Change price → new carts get new price  

## Monorepo notes

- Prisma client is generated from `packages/database` during build.  
- Do not set `STRIPE_MOCK_MODE=true` on production.  
- Preview and production **must** use separate databases and Stripe keys.
