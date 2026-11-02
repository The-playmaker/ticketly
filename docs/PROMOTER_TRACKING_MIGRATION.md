# Production hotfix: promoter tracking DB migration

## Required on production (do this first)

```bash
npm run db:migrate
# = prisma migrate deploy
# Applies: packages/database/prisma/migrations/20261102150000_promo_promoter_tracking
```

Adds:
- enum `PromoCodeKind` (`DISCOUNT` | `TRACKING`)
- columns `PromoCode.label`, `PromoCode.kind`

Until migrated, `/admin/promoters` shows «Database-migrasjon mangler» instead of crashing (P2022).

## Schema generate note

`packages/database/prisma/apply-promoter-schema.mjs` patches `PromoCodeKind` + `label`/`kind` into `schema.prisma` before `prisma generate` if missing from the committed schema tree.
