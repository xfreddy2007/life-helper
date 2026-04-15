# 居家生活小幫手 (Life Helper)

> A LINE Bot-powered household management assistant that helps families track inventory, monitor consumption, and receive smart purchase reminders — all through natural language conversation.

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](./package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17.0-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)

---

## Overview

Life Helper is a family-oriented LINE Bot that manages household supplies. Members of a shared LINE group can interact with the bot using natural language to:

- Query current inventory levels by item or category
- Record consumption after cooking or daily use (with anomaly detection)
- Add new stock after shopping trips (via text or receipt photo scan with Claude Vision)
- Receive weekly purchase reminders and daily consumption confirmation push
- Track batch expiry dates with first-in-first-out (FIFO) deduction
- Automatic expiry alerts at 08:00 daily for items approaching or past their expiry date
- Receipt name mapping: remembers how receipt product names map to your inventory items

---

## Tech Stack

| Layer            | Technology                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Monorepo         | [Turborepo](https://turbo.build) + npm workspaces                                                           |
| Bot Interface    | [LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/) (`@line/bot-sdk` v9)               |
| Backend API      | [Express](https://expressjs.com) v4 + [ts-rest](https://ts-rest.com)                                        |
| AI / NLU         | [Anthropic Claude API](https://docs.anthropic.com) (`claude-sonnet-4-6`) with Prompt Caching                |
| Database         | PostgreSQL 16 (local: Docker; production: Fly Managed Postgres)                                             |
| Cache / Sessions | Redis 7 (local: Docker; production: [Upstash](https://upstash.com))                                         |
| ORM              | [Prisma](https://www.prisma.io) v6                                                                          |
| Language         | TypeScript 5.8 (strict mode)                                                                                |
| Testing          | [Vitest](https://vitest.dev) v3 + [@vitest/coverage-v8](https://vitest.dev/guide/coverage) (≥80% threshold) |
| Error Tracking   | [Sentry](https://sentry.io) (`@sentry/node` v8) with Express error handler                                  |
| Deployment       | [Fly.io](https://fly.io) (Singapore region)                                                                 |
| Linting          | ESLint 9 (flat config) + Prettier                                                                           |
| Versioning       | [Changesets](https://github.com/changesets/changesets)                                                      |

---

## Prerequisites

| Tool           | Version   | Install                                                           |
| -------------- | --------- | ----------------------------------------------------------------- |
| Node.js        | ≥ 18.17.0 | [nvm](https://github.com/nvm-sh/nvm) recommended                  |
| npm            | ≥ 9.0.0   | Bundled with Node.js                                              |
| Docker         | ≥ 24      | [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Docker Compose | v2        | Bundled with Docker Desktop                                       |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/xfreddy2007/life-helper.git
cd life-helper
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

| Variable                    | Description                          | Where to get                                           |
| --------------------------- | ------------------------------------ | ------------------------------------------------------ |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot channel token               | [LINE Developer Console](https://developers.line.biz)  |
| `LINE_CHANNEL_SECRET`       | LINE Bot channel secret              | [LINE Developer Console](https://developers.line.biz)  |
| `LINE_GROUP_ID`             | Target LINE group ID                 | From incoming webhook payload                          |
| `ANTHROPIC_API_KEY`         | Claude API key                       | [console.anthropic.com](https://console.anthropic.com) |
| `DATABASE_URL`              | PostgreSQL connection string         | Pre-filled for local Docker                            |
| `REDIS_URL`                 | Redis connection string              | Pre-filled for local Docker                            |
| `SENTRY_DSN`                | Sentry error tracking DSN (optional) | [sentry.io](https://sentry.io)                         |

### 4. Start local infrastructure

```bash
docker compose up -d
```

This starts:

- **PostgreSQL 16** on `localhost:5432`
- **Redis 7** on `localhost:6379`

Verify containers are healthy:

```bash
docker compose ps
```

### 5. Set up the database

```bash
# Generate Prisma client
npm run db:generate --workspace=packages/database

# Run migrations
npm run db:migrate --workspace=packages/database

# Seed default categories
npm run db:seed --workspace=packages/database
```

### 6. Start the development server

```bash
npm run dev
```

The bot server starts on `http://localhost:3000`.

### 7. Expose local server for LINE Webhook

LINE requires a public HTTPS URL. Use [ngrok](https://ngrok.com) during local development:

```bash
# Install ngrok
brew install ngrok

# In a separate terminal
ngrok http 3000
```

Copy the HTTPS forwarding URL (e.g. `https://xxxx.ngrok-free.app`) and set the webhook URL in the LINE Developer Console:

```
https://xxxx.ngrok-free.app/webhook
```

---

## Project Structure

```
life-helper/
├── apps/
│   └── bot/                  # LINE Bot + Express API server
│       └── src/
│           ├── main.ts        # Server entry point
│           ├── handlers/      # Intent handlers (inventory, consumption, etc.)
│           ├── services/      # Business logic (NLU, vision, scheduler, etc.)
│           └── cron/          # Scheduled jobs (daily confirm, weekly purchase)
│
├── packages/
│   ├── database/              # Prisma schema, client, repositories
│   ├── contracts/             # ts-rest API contracts + Zod schemas
│   ├── test-utils/            # Shared test helpers and factories
│   ├── eslint-config/         # Shared ESLint flat config
│   └── typescript-config/     # Shared tsconfig presets
│
├── docker-compose.yml         # Local PostgreSQL + Redis
├── .env.example               # Environment variable template
└── turbo.json                 # Turborepo pipeline config
```

---

## Available Scripts

Run from the **repository root** unless specified.

| Script                     | Description                                  |
| -------------------------- | -------------------------------------------- |
| `npm run dev`              | Start all packages in dev/watch mode         |
| `npm run build`            | Build all packages                           |
| `npm run test`             | Run all test suites                          |
| `npm run check-types`      | TypeScript type check across all packages    |
| `npm run lint`             | ESLint across all packages                   |
| `npm run format`           | Prettier format all files                    |
| `npm run changeset`        | Create a new version changeset               |
| `npm run version-packages` | Apply pending changesets and update versions |

### Database scripts (run from `packages/database`)

```bash
npm run db:generate    # Generate Prisma client
npm run db:migrate     # Run migrations (dev)
npm run db:push        # Push schema without migration (prototype)
npm run db:seed        # Seed default data
npm run db:studio      # Open Prisma Studio GUI
```

---

## Git Branching Strategy

This project follows a three-tier Git flow:

```
main        ← production (protected)
  └── staging  ← pre-production testing
        └── dev  ← active development
```

| Branch    | Purpose                | Deploy target     |
| --------- | ---------------------- | ----------------- |
| `main`    | Stable production code | Fly.io production |
| `staging` | Pre-release testing    | Fly.io staging    |
| `dev`     | Daily development work | Local / ngrok     |

**Workflow:**

1. Branch off `dev` for your feature/fix (`feat/xxx` or `fix/xxx`)
2. Open a PR targeting `dev`
3. After review, merge to `dev`
4. When ready to release: `dev` → `staging` → `main`

---

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>[optional scope]: <description>
```

| Type       | When to use                                |
| ---------- | ------------------------------------------ |
| `feat`     | New feature                                |
| `fix`      | Bug fix                                    |
| `chore`    | Maintenance (deps, config, tooling)        |
| `refactor` | Code restructuring without behavior change |
| `test`     | Adding or updating tests                   |
| `docs`     | Documentation changes                      |
| `perf`     | Performance improvements                   |

**Examples:**

```
feat(bot): add receipt image recognition for restock flow
fix(consumption): correct FIFO batch deduction when quantity spans batches
chore: upgrade Prisma to v6.2.0
```

---

## Versioning

This project uses [Semantic Versioning](https://semver.org) managed by [Changesets](https://github.com/changesets/changesets).

**After implementing a feature or fix:**

```bash
# 1. Create a changeset
npm run changeset
# → Select affected packages
# → Choose bump type: patch / minor / major
# → Write a summary

# 2. Commit the changeset alongside your code changes
git add .changeset/
git commit -m "feat: ..."

# 3. Apply versions when releasing
npm run version-packages
```

| Change type     | Bump    | Example         |
| --------------- | ------- | --------------- |
| Bug fix         | `patch` | `0.1.0 → 0.1.1` |
| New feature     | `minor` | `0.1.1 → 0.2.0` |
| Breaking change | `major` | `0.2.0 → 1.0.0` |

---

## Testing

Run the full test suite:

```bash
npm run test
```

Run with coverage report:

```bash
npm run test:coverage --workspace=apps/bot
```

Coverage thresholds (enforced in CI):

| Metric     | Threshold |
| ---------- | --------- |
| Lines      | ≥ 80%     |
| Functions  | ≥ 80%     |
| Branches   | ≥ 75%     |
| Statements | ≥ 80%     |

Infrastructure files (cron jobs, Express wiring, config, Redis client) are excluded from coverage — they are integration-tested via the full server boot rather than unit tests.

---

## Deployment

The bot is deployed to [Fly.io](https://fly.io) in the Singapore (`sin`) region for low-latency LINE webhook responses from Taiwan.

```bash
# Install Fly CLI
brew install flyctl

# Authenticate
flyctl auth login

# Deploy
flyctl deploy
```

Refer to `fly.toml` for machine configuration.

---

## Environment Requirements

- **LINE Official Account** with Messaging API enabled
- **Anthropic API** account with access to `claude-sonnet-4-6`
- **Fly.io** account (for production deployment)
- **Upstash Redis** account (for production Redis)

---

## Contributing

1. Fork the repository
2. Create a feature branch from `dev`: `git checkout -b feat/your-feature`
3. Make your changes following the commit convention
4. Create a changeset: `npm run changeset`
5. Push and open a PR targeting `dev`
6. Ensure all checks pass: `npm run check-types && npm run lint && npm run test`

---

## License

MIT © [xfreddy2007](https://github.com/xfreddy2007)
