FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/validation/package.json ./packages/validation/
COPY packages/auth/package.json ./packages/auth/
COPY packages/ticketing/package.json ./packages/ticketing/
COPY packages/payments/package.json ./packages/payments/
COPY packages/notifications/package.json ./packages/notifications/
COPY packages/wallet/package.json ./packages/wallet/
COPY packages/ui/package.json ./packages/ui/
RUN npm install --legacy-peer-deps --workspace=@ticketly/web --workspace=@ticketly/database --include-workspace-root

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://ticketly:ticketly@db:5432/ticketly?schema=public"
WORKDIR /app/packages/database
RUN npx prisma generate
WORKDIR /app/apps/web
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3456
ENV HOSTNAME=0.0.0.0
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 nextjs
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
USER nextjs
EXPOSE 3456
ENTRYPOINT ["./docker-entrypoint.sh"]
