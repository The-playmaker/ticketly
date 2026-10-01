#!/bin/sh
set -e
echo "Running database migrations..."
cd /app/packages/database && npx prisma migrate deploy
echo "Seeding database (idempotent)..."
npx tsx prisma/seed.ts || true
echo "Starting Ticketly..."
cd /app && exec node apps/web/server.js
