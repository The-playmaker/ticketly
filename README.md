# Ticketly (monorepo)

Produksjonsklar billettplattform med **web**, **native iOS/Android (Expo)** og delt backend.

Se [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) før større UI-arbeid.

## Struktur

```
apps/web          Next.js (butikk, admin, API-ruter)
apps/mobile       Expo React Native (kunde + staff/scanner)
apps/api          Valgfri Hono-host (samme packages)
packages/database Prisma
packages/*        auth, validation, ticketing, payments, notifications, wallet, ui, shared-types
docs/             Arkitektur, offline-scanner, App Store
```

## Hurtigstart

```bash
cp .env.example .env
npm install --legacy-peer-deps
npm run db:migrate
npm run db:seed
npm run dev:web          # http://localhost:3456
npm run dev:mobile       # Expo (port 8082)
```

Docker: `docker compose up --build` (web + Postgres).

## Payments

Production default: **Nexi Checkout** (`PAYMENT_PROVIDER=nexi`). Stripe is optional/fallback.
Local demo: `PAYMENT_PROVIDER=mock`. See [docs/PAYMENTS.md](docs/PAYMENTS.md) and [docs/NEXI_CHECKOUT.md](docs/NEXI_CHECKOUT.md).

## Hardening / launch docs

- [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) — **start here for tomorrow**
- [docs/PAYMENTS.md](docs/PAYMENTS.md) · [docs/NEXI_CHECKOUT.md](docs/NEXI_CHECKOUT.md)
- [docs/LAUNCH_GAP_ANALYSIS.md](docs/LAUNCH_GAP_ANALYSIS.md)
- [docs/VERCEL_DEPLOYMENT.md](docs/VERCEL_DEPLOYMENT.md)
- [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md)
- [docs/BACKUP_AND_RECOVERY.md](docs/BACKUP_AND_RECOVERY.md)
- [docs/TICKET_STATE_MACHINE.md](docs/TICKET_STATE_MACHINE.md)
- [docs/LOAD_TESTING.md](docs/LOAD_TESTING.md)
- [docs/MOBILE_PAYMENTS.md](docs/MOBILE_PAYMENTS.md)

Organizer: `/admin` → **Nytt arrangement** → release inventory → publish → share `/events/{slug}`.

```bash
npm test                 # unit + integration
npm run test:e2e         # Playwright (server must be running)
k6 run load/k6-smoke.js  # optional load profile
```

Health: `GET /api/health` · Ready: `GET /api/ready`

## Demo-brukere

| E-post | Rolle | Passord |
|--------|-------|---------|
| organizer@example.com | ORGANIZER_ADMIN | password123 |
| door@example.com | DOOR_STAFF | password123 |
| customer@example.com | CUSTOMER | password123 |
| admin@example.com | SUPER_ADMIN | password123 |

## Mobil

- Autentiseringstokens i **SecureStore** (Keychain/Keystore)
- Offline «Mine billetter» med kryptert cache
- Staff-scanner med native kamera, haptikk/vibrasjon, offline-bundle + sync
- Wallet/Push: abstraksjoner — ingen falske Apple/Google Wallet-passes
- Bundle IDs: `no.ticketly.app` — se [docs/APP_STORE.md](docs/APP_STORE.md)

## Compliance (kort)

- Seller of record ≠ nødvendigvis platform (`Event.sellerOrganizationId`)
- Ingen platform-/organizer-wallet for kundemidler
- Angrerett/refusjon som policy-typer (ikke generisk 14 dager)
- GDPR: `ConsentRecord` per formål; markedsføring aldri auto-på
- Immutable `OrderSnapshot` ved kjøp

Dette er **ikke** juridisk rådgivning.
