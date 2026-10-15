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

1. **Production** — live domain, **Nexi production** keys, production DB  
2. **Preview** — staging subdomain, **Nexi test** keys, staging DB  

Preview must not accidentally use live credentials unless explicitly configured.

## Required environment variables

### Core (all envs)

| Variable | Example / notes |
|----------|-----------------|
| `DATABASE_URL` | Postgres connection string (pooled OK for serverless; use direct URL for migrations) |
| `AUTH_SECRET` | `openssl rand -base64 32` — ≥32 chars |
| `APP_URL` | `https://ticketly.no` (no trailing slash) |
| `NEXT_PUBLIC_APP_URL` | Same public URL as `APP_URL` |
| `PAYMENT_PROVIDER` | **`nexi`** (production default) |

### Auth.js / NextAuth

| Variable | Notes |
|----------|--------|
| `AUTH_SECRET` | Same as above |
| `AUTH_URL` | Optional; set to `APP_URL` if callbacks fail |
| Auth callback | `{APP_URL}/api/auth/callback/credentials` (and providers you enable) |

Add production + preview domains under Vercel → Project → Settings → Domains, and in any OAuth provider allowlists.

### Nexi Checkout (primary)

| Variable | Production | Preview/Staging |
|----------|------------|-----------------|
| `PAYMENT_PROVIDER` | `nexi` | `nexi` |
| `NEXI_ENVIRONMENT` | **`production`** | **`test`** |
| `NEXI_SECRET_API_KEY` | Live secret API key | Test secret API key |
| `NEXI_CHECKOUT_KEY` | Live checkout key | Test checkout key |
| `NEXI_WEBHOOK_SECRET` | 8–64 char shared secret | Separate secret for preview |
| `NEXI_MERCHANT_ID` | If required by agreement | If required |

Webhook endpoint: `POST {APP_URL}/api/payments/nexi/webhook`  

Startup/config validation **fails** in production if Nexi live configuration is missing when `PAYMENT_PROVIDER=nexi`.  
**Do not** silently fall back to mock payments in production.

### Stripe (optional / fallback)

Only required when `PAYMENT_PROVIDER=stripe`.

| Variable | Production | Preview/Staging |
|----------|------------|-----------------|
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | `pk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from **live** endpoint | `whsec_…` from **test** endpoint |
| `STRIPE_MOCK_MODE` | **`false`** | Prefer `false` + test keys |

Webhook endpoint: `POST {APP_URL}/api/payments/stripe/webhook`

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

Includes Nexi payment fields / `OrganizationPaymentConfiguration` / webhook status columns.

## Post-deploy smoke

1. `GET /api/health` → `{ status: "ok" }`  
2. `GET /api/ready` → database ok  
3. Admin login → create event → release 50 → publish  
4. Public `/events/{slug}` → reserve → checkout (Nexi test) → webhook → QR  
5. Admin live feed shows sale  
6. Pause sales → new reserve fails  
7. Change price → new carts get new price  
8. Admin → Webhooks shows Nexi events  
9. Refund one test order → scanner rejects QR  

## Monorepo notes

- Prisma client is generated from `packages/database` during build.  
- Production: `PAYMENT_PROVIDER=nexi`, never `mock`.  
- Preview and production **must** use separate databases and Nexi key sets (`test` vs `production`).
