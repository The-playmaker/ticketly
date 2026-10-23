# Production users & organizations

How to bootstrap Ticketly for real production use — **no demo passwords or seed credentials**.

## Prerequisites

- Database migrations applied: `npm run db:migrate` (`prisma migrate deploy` only — never `db push` / `migrate reset` against production).
- `AUTH_SECRET`, `APP_URL`, payment provider, and `EMAIL_PROVIDER=resend` configured.
- Do **not** set `SEED_MODE` in production. `npm run db:seed` requires `SEED_MODE=development` or `SEED_MODE=demo` and will refuse otherwise.

## 1. Create the first SUPER_ADMIN

```bash
ADMIN_EMAIL=you@company.no \
ADMIN_FIRST_NAME=Ada \
ADMIN_LAST_NAME=Lovelace \
ADMIN_PASSWORD='use-a-long-passphrase' \
npm run admin:create
```

- Password minimum **12 characters** (no silly complexity rules).
- Password is never printed.
- Re-running upserts the same email as SUPER_ADMIN.

## 2. Log in

Open `/login`. Production login fields are **empty** and show **no demo credential text**.

Dev-only prefill requires both `NODE_ENV !== production` and `NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=true`.

## 3. Create a real organization (seller of record)

As SUPER_ADMIN:

1. Use admin settings / org API to create or edit an organization.
2. Fill required seller fields:
   - Legal name, organization number
   - Display name
   - Address, postal code, city, country
   - Support email (and phone if available)
   - VAT status, terms version, refund policy text

Do not copy Titan Events / example.com seed data into production.

## 4. Invite organizers and door staff

1. Open **Innstillinger → Team** (`/admin/settings/team`).
2. Invite by email with role:
   - `ORGANIZER_ADMIN` — org admin (treated as owner for last-admin protection)
   - `EVENT_MANAGER` — event operations
   - `DOOR_STAFF` — scanner + attendee lookup on assigned events only
3. Invitee receives an email link → confirms → sets password (never sent in email).
4. Invites are single-use, hashed at rest, expiring (`PENDING` / `ACCEPTED` / `EXPIRED` / `REVOKED`).

## 5. Assign events (door staff)

When inviting or editing a door staff member, restrict to specific events. Door staff without assignments cannot scan. They cannot access revenue, refunds, org settings, user admin, or settlement by default.

**Paused sales ≠ no scanner:** Event status `PAUSED` (or `salesPausedAt`) stops new ticket sales but **must remain visible** on `/scan`. Scanner lists include `PUBLISHED`, `PAUSED`, `SOLD_OUT`, and `COMPLETED`.

**Diagnose empty scanner:** Team → «Scanner-tilgang diagnostikk» (or `GET /api/admin/team/scanner-diagnostic?email=…&organizationId=…`) shows membership, `EventAssignment` rows, event status, and allow/deny reasons.

### Dual-domain / cookie risk

Team admin and the scanner must hit the **same** production database and `AUTH_SECRET`. Do not invent a multi-DB setup: if Team (e.g. one Vercel alias) and `/scan` (another domain/project) use different `DATABASE_URL`, you can see an event selected in Team while the scanner says «Ingen arrangementer». Auth session cookies are **host-scoped** — `APP_URL` / `AUTH_URL` / `NEXT_PUBLIC_APP_URL` must match the hostname the user logs into; cross-domain cookies will not share sessions.

## 6. Disable test staff

Prefer **Disable** over delete:

- Platform: `/admin/platform/users` (SUPER_ADMIN)
- Org: Team → Disable access / Remove from organization (keeps the global user)

Disabled users fail login and lose JWT access on the next session refresh.

## 7. Verify no demo users

SUPER_ADMIN readiness: `/admin/platform/readiness` (or `GET /api/admin/platform/readiness`).

Inventory / remove demo identities only with:

```bash
npm run demo:cleanup -- --dry-run
# review output, then explicitly:
npm run demo:cleanup -- --confirm-demo-delete
```

- Never auto-runs.
- Refuses `NODE_ENV=production` unless `--allow-production` is also passed.
- Deletes only known demo emails/slugs (`@example.com`, `titan-events`, etc.).

## Password reset

`/forgot-password` always responds: *Hvis kontoen finnes, har vi sendt instruksjoner.*  
Reset uses hashed, single-use, expiring `AuthActionToken` rows and `/set-password`.

## Safety invariants

- Last active SUPER_ADMIN cannot remove their own SUPER_ADMIN role or disable themselves without another active SUPER_ADMIN.
- Last active `ORGANIZER_ADMIN` in an org cannot be removed/demoted/disabled without another.
- Audit actions include `USER_INVITED`, `INVITE_ACCEPTED`, `USER_DISABLED`, `USER_ENABLED`, `ORG_MEMBER_ADDED`, `ORG_MEMBER_REMOVED`, `ROLE_CHANGED`, `EVENT_ACCESS_CHANGED`.

## `lastActiveAt` (do not write on auth)

`User.lastActiveAt` remains in the schema for admin display, but **must not** be updated from credentials authorize, JWT/session refresh, mobile login, scanner, checkout, or page-render paths.

Concurrent auth requests that all `UPDATE "User" SET "lastActiveAt"` on the same row caused Postgres statement timeouts (`57014` / Prisma `P2024`) and login instability.

**Safe future design (not implemented):** a dedicated, throttled activity endpoint (e.g. once per 30–60 minutes), using a conditional update (`WHERE lastActiveAt IS NULL OR lastActiveAt < …`), called best-effort / non-blocking, never on the login critical path. Login success must not depend on activity telemetry.
