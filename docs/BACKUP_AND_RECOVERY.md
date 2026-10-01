# Backup and Recovery

This document describes operational backup/restore for Ticketly PostgreSQL. Ticketly does not ship a fake in-app backup button — backups are an infrastructure concern.

## Scope

- **Primary data store:** PostgreSQL (`packages/database` Prisma schema)
- **Not in DB:** Stripe funds (PSP holds money), Apple/Google Wallet certs, Expo push credentials
- **Also protect:** `.env` / secret manager values, Stripe webhook endpoint config

## Environments

| Environment | Database | Stripe | Notes |
|-------------|----------|--------|-------|
| development | local Docker / local Postgres | `STRIPE_MOCK_MODE=true` | Disposable |
| staging | dedicated staging DB | **test** keys only | Never prod keys |
| production | dedicated prod DB | live keys | Separate secrets/domain |

## RPO / RTO targets (recommended)

| Tier | RPO | RTO |
|------|-----|-----|
| Production | ≤ 15 minutes (WAL/PITR) | ≤ 1 hour for DB restore |
| Staging | ≤ 24 hours | ≤ 4 hours |

Adjust to your hosting SLA. Document the actual numbers for your deploy target.

## PostgreSQL backup (production)

### Continuous (preferred)

Use managed Postgres with **point-in-time recovery** (PITR), e.g.:

- AWS RDS / Aurora automated backups + transaction logs
- Neon / Supabase / Cloud SQL PITR
- Self-hosted: `pg_basebackup` + WAL archiving to object storage

### Logical dump (daily)

```bash
# Example — run from a secure ops host, never commit dumps
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --file="ticketly-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Encrypt dumps at rest (KMS / age / GPG) before offsite copy.

### What to exclude from casual dumps

Avoid copying production dumps to laptops. If needed for support, use anonymized staging restores.

## Restore procedure (test quarterly)

1. Provision empty Postgres instance (or staging clone).
2. Restore:

```bash
pg_restore --clean --if-exists --no-owner \
  -d "$RESTORE_DATABASE_URL" \
  ticketly-YYYYMMDD.dump
```

3. Run `npx prisma migrate status` against restore DB — migrations should match.
4. Smoke checks:
   - `GET /api/health` and `GET /api/ready`
   - Login as staging user
   - Open one known order (access token path)
   - Scanner check-in against a test ticket
5. Record restore duration (feeds RTO).

### PITR restore

Follow your provider’s “restore to timestamp” UI/CLI. Choose a timestamp **before** the incident and **after** the last known-good migration.

## Migration rollback strategy

Prisma migrations are **forward-only** in production by default.

1. Prefer **expand/contract**: add columns nullable → backfill → constrain; drop later.
2. For bad deploy: deploy previous app version that is compatible with current schema.
3. Only write a new compensating migration to undo data/schema — do not `migrate resolve` away applied migrations without a plan.
4. Keep `docs/SECURITY_AUDIT.md` / this file updated when irreversible changes ship (e.g. hashing QR tokens).

## Application-level integrity after restore

- Stripe webhooks may replay — `WebhookEvent` unique `(provider, eventId)` makes replays safe.
- Reservations may be expired — `ReservationService.releaseExpired` cleans ACTIVE holds.
- Mobile sessions remain valid until `expiresAt` / `revokedAt` — force-revoke via `MobileSession` if credentials leaked.

## Secrets recovery

Restore secrets from the secret manager (not Git). Rotate after any suspected leak:

- `AUTH_SECRET`
- `TICKET_TOKEN_SECRET` / `OFFLINE_BUNDLE_SECRET`
- Stripe keys + webhook secret
- Database credentials

Rotating `TICKET_TOKEN_SECRET` invalidates `tokenCipher` decryption for display; validation via `tokenHash` still works if hashes were not keyed by that secret (SHA-256 of raw token is not HMAC’d with app secret).

## Test restore checklist

- [ ] Quarterly restore to isolated DB
- [ ] App boots against restored DB
- [ ] Order + ticket QR still validate
- [ ] Admin reports load
- [ ] Document actual RPO/RTO achieved
