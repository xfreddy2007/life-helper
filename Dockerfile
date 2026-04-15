# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package manifests first for better layer caching
COPY package*.json turbo.json ./
COPY apps/bot/package.json ./apps/bot/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/test-utils/package.json ./packages/test-utils/
COPY packages/typescript-config/package.json ./packages/typescript-config/

RUN npm ci

# Copy all source files
COPY . .

# Generate Prisma client for the linux target (produces correct engine binaries)
RUN npm run db:generate --workspace=packages/database

# Bundle the bot into dist/
RUN npm run build --workspace=apps/bot

# ── Stage 2: Runner ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Prisma query engine (library mode) requires openssl
RUN apk add --no-cache openssl

# Runtime dependencies (node_modules contains the Prisma-generated engines)
COPY --from=builder /app/node_modules ./node_modules

# Compiled bot bundle
COPY --from=builder /app/apps/bot/dist ./dist

# Prisma schema — needed by `prisma migrate deploy` (run via fly.toml release_command)
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma

EXPOSE 3000

CMD ["node", "--enable-source-maps", "dist/main.cjs"]
