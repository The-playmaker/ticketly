# ─── Dependencies stage ───────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://ticketly:ticketly@db:5432/ticketly?schema=public"
RUN npx prisma generate
RUN npm run build

# ─── Runner stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3456
ENV HOSTNAME=0.0.0.0

RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3456
ENTRYPOINT ["./docker-entrypoint.sh"]
