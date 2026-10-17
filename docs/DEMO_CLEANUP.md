# Demo data cleanup

`npm run demo:cleanup` removes **only** known seed/demo identities. It never runs automatically and must never be pointed at production without an explicit inventory review.

## Usage

```bash
# Inventory only (default if --confirm-demo-delete is omitted)
npm run demo:cleanup -- --dry-run

# After reviewing the inventory
npm run demo:cleanup -- --confirm-demo-delete
```

In `NODE_ENV=production` the script exits unless you also pass `--allow-production`.

## What it targets

- Users: `admin@example.com`, `organizer@example.com`, `door@example.com`, `customer@example.com`, and related example.com seed accounts
- Organizations: `titan-events`, `shot-spot`, `bloms`, `noir`, `festival-as`
- Events: `friday-night`, `ticketly-payment-test`, plus events under those orgs

## What it does not do

- Does not delete arbitrary production users or orgs
- Does not run from seed, deploy, or CI by default
- Does not print or require passwords

Prefer disabling staff in `/admin/platform/users` when you only need to lock accounts.

To clear **sales/test rows for one event** (orders, tickets, inventory counters) without deleting the event, use the SUPER_ADMIN **Nullstill testdata** flow — see [EVENT_TEST_DATA_RESET.md](./EVENT_TEST_DATA_RESET.md).

See also [PRODUCTION_USERS.md](./PRODUCTION_USERS.md).
