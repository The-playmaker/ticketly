# Ticketly Architecture

> This document specifies the cross-cutting architecture for web, iOS, and Android.
> Large UI work should follow these contracts. This is **not legal advice**.

## Monorepo

```
apps/
  web/          Next.js App Router (storefront + admin + API routes)
  mobile/       Expo React Native (customer + staff/scanner mode)
  api/          Optional standalone Hono API (same packages; for future split)
packages/
  database/     Prisma schema + client
  shared-types/ DTOs / domain contracts
  validation/   Zod schemas
  auth/         RBAC helpers
  ticketing/    Offline sync, compliance, shared ticket lifecycle helpers
  payments/     PaymentProvider + settlement reporting (no wallets)
  notifications/ PushProvider (Expo → APNs/FCM)
  wallet/       Apple/Google Wallet providers (no fake passes)
  ui/           Shared design tokens (minimal)
```

Web and mobile share: database, auth model, validation, ticketing/business rules, payments, notifications.

## Party model (Norwegian / EEA)

Explicit roles — do not assume the platform is the seller:

| Role | Meaning |
|------|---------|
| PLATFORM | Ticketly operator |
| ORGANIZER | Runs the event (`Event.organizationId`) |
| SELLER_OF_RECORD | Legal seller (`Event.sellerOrganizationId`) |
| PAYMENT_PROVIDER | Licensed PSP — **current production: Stripe** Checkout Form; Nexi future/optional; Vipps via Nexi when enabled |
| CUSTOMER | Buyer / ticket holder |

Checkout, confirmation, and receipts must show **seller legal name, org.nr, address, customer service**.

## Payments (no platform wallet)

- **Forbidden**: platform wallet, organizer wallet, manual balance accounts holding customer funds.
- Funds move only via licensed PSP; prefer Connect / marketplace settlement to seller.
- Fields `organizerAmount`, `platformFeeAmount`, `paymentProcessingFee` are **reporting only**.

## Tax

- `TaxCode` → `TaxRate` → `TaxTreatment`
- Ticket types and platform fees reference treatments configured by admin/accounting.
- Do **not** infer VAT from event names.

## Refunds / angrerett

Types:

- `STATUTORY_CANCELLATION_RIGHT`
- `ORGANIZER_REFUND_POLICY`
- `EVENT_CANCELLED_REFUND`
- `MANUAL_REFUND`
- `NO_REFUND`

Do **not** default to a generic 14-day refund for dated leisure events.
Show organizer policy before pay. `Order.termsVersion` + `termsAcceptedAt` are required.

## GDPR

- `ConsentRecord` per purpose/version (marketing never auto-on from purchase).
- Separate processing purposes: contract, accounting, support, event info, analytics, marketing.
- Data subject requests: access / export / rectify / erase (respect legal retention).
- `RetentionPolicy` per data category.

## Order immutability

`OrderSnapshot` freezes seller, prices, tax, event, and terms at purchase time.
Later org renames must not rewrite history.

## Ticket lifecycle

VALID → CHECKED_IN | TRANSFERRED | CANCELLED | REFUNDED

QR uses cryptographic tokens (never sequential IDs). Online validation is authoritative.

## Offline scanner

See `packages/ticketing/src/offline.ts`.

1. Prefer online atomic check-in.
2. Offline bundle: encrypted, per-event, **no PII** (publicId + token hash + status).
3. Local queue with sequence numbers; sync with conflict handling (first success wins).
4. Refresh bundles often; tickets sold after download are invisible offline.

## Devices

`Device` + `ScannerSession`. Organizer can revoke devices. Door staff only see assigned events.

## Mobile security

- Auth tokens: Expo SecureStore (Keychain / Keystore) — never AsyncStorage for secrets.
- Offline ticket cache: encrypt at rest where relevant.
- Camera permission: primarily Staff/Scanner mode (just-in-time).

## Push

`PushProvider`: Expo (v1) → APNs / FCM later.
Categories: TRANSACTIONAL | SERVICE | MARKETING (prefs + consent for marketing only).

## Wallet

`WalletPassProvider` returns `UNAVAILABLE` until Apple/Google credentials exist.
No simulated passes.
