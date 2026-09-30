# Ticketly

Produksjonsklar billettsalgsplattform for arrangementer, konserter og nattklubber.

Stack: **Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · PostgreSQL · Prisma · Auth.js · Stripe · Zod · React Hook Form**

## Funksjoner

- Multi-tenant organisasjoner med RBAC (`SUPER_ADMIN`, `ORGANIZER_ADMIN`, `EVENT_MANAGER`, `DOOR_STAFF`, `CUSTOMER`)
- Arrangementer, billettyper, early-bird prisnivåer, promokoder, serviceavgift
- Reservasjon med radlåsing (10 min) for å unngå oversalg
- Stripe Checkout + webhook-basert bekreftelse (Vipps-stub klar for ePayment API)
- Kryptografisk sikre QR-billetter, PDF-nedlasting, wallet-arkitektur (stub)
- Mobil scanner (`/scan`) med kamera, manuell gjesteliste og atomisk check-in
- Admin dashboard, event dashboard, CSV/Excel-rapporter, audit log
- Guest checkout uten konto

## Hurtigstart (lokal uten Docker)

### Forutsetninger

- Node.js 22+
- PostgreSQL 16+

### 1. Installer avhengigheter

```bash
npm install --legacy-peer-deps
```

### 2. Miljøvariabler

```bash
cp .env.example .env
```

Sett minst:

```env
DATABASE_URL="postgresql://ticketly:ticketly@localhost:5432/ticketly?schema=public"
AUTH_SECRET="generer-en-lang-hemmelighet"
APP_URL="http://localhost:3456"
NEXT_PUBLIC_APP_URL="http://localhost:3456"
STRIPE_MOCK_MODE="true"
```

Med `STRIPE_MOCK_MODE=true` kan du gjennomføre hele betalingsflyten lokalt uten Stripe-nøkler. Sett til `false` og fyll inn ekte testnøkler + webhook-secret for Stripe.

### 3. Database

```bash
npx prisma migrate deploy
npm run db:seed
```

### 4. Start utviklingsserver

```bash
npm run dev
```

Åpne [http://localhost:3456](http://localhost:3456)

## Docker Compose

```bash
cp .env.example .env
# sett AUTH_SECRET i .env
docker compose up --build
```

App: `http://localhost:3456` · Postgres: `localhost:5432`

## Demo-brukere (kun development seed)

| E-post | Rolle | Passord |
|--------|-------|---------|
| admin@example.com | SUPER_ADMIN | password123 |
| organizer@example.com | ORGANIZER_ADMIN (Titan Events) | password123 |
| door@example.com | DOOR_STAFF | password123 |
| customer@example.com | CUSTOMER | password123 |

Seed-event: **Friday Night** → `/events/friday-night`  
Promokode: `VIP20` (20 %)

## Viktige URL-er

| Side | URL |
|------|-----|
| Forside | `/` |
| Event | `/events/friday-night` |
| Checkout | via event → billetter |
| Ordrebekreftelse | `/orders/TKT-…` |
| Mine billetter | `/my/tickets` |
| Admin | `/admin` |
| Scanner | `/scan` |
| Stripe webhook | `POST /api/payments/stripe/webhook` |

## Stripe webhook (produksjon)

```bash
stripe listen --forward-to localhost:3456/api/payments/stripe/webhook
```

Hendelser som håndteres (idempotent via `WebhookEvent`):

- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

Ordre markeres **ikke** som betalt basert på frontend-redirect — kun webhook / bekreftet provider-event.

## Arkitektur

```
src/
  app/           # Next.js routes (public, admin, scan, API)
  components/    # UI
  lib/           # auth, payments, email, security, validators
  services/      # Order, Ticket, CheckIn, Payment, Event, Refund, Reservation
  repositories/  # (utvid ved behov)
prisma/          # schema, migrations, seed
tests/           # unit + integration
```

### Betaling

`PaymentProvider`-interface med:

- `StripePaymentProvider` (produksjon)
- `MockStripePaymentProvider` (lokal demo)
- `VippsPaymentProvider` (**stub / TODO** — ingen falsk Vipps-flyt)

### E-post

`EmailProvider` med `ConsoleEmailProvider` (default) og stub for Resend.

### Wallet

`WalletPassProvider` stub for Apple/Google Wallet senere.

## Tester

```bash
npm test
npm run typecheck
npm run lint
```

Kritiske tester dekker kapasitet/race, dobbel check-in, refundert billett, webhook-idempotens og RBAC.

## Sikkerhet

- RBAC på backend (ikke kun frontend)
- Organisasjonsisolasjon
- Zod-validering
- Rate limiting (login/checkout/QR/promo)
- Sikre HTTP-headere
- QR via `crypto.randomBytes` (ikke sekvensielle ID-er)
- Pengesummer i øre (integer)
- Tid i UTC, presentasjon i event-timezone (`Europe/Oslo`)

## Videre

Arkitekturen er lagt til rette for Vipps MobilePay, Nets, Apple/Google Wallet, SMS, seat maps, venteliste, white-label, m.m. uten omskriving av ordrekjernen.
