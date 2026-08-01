// instrument.ts must be the very first import so Sentry can patch express/http
// before they are loaded by any other module.
import './instrument.js';

import express from 'express';
import { createServer } from 'http';
import * as Sentry from '@sentry/node';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeRedis } from './lib/redis.js';
import { NluService } from './services/nlu/nlu.service.js';
import { cronManager } from './cron/cron-manager.js';
import { SlackAdapter } from './adapters/slack-adapter.js';
import type { AdapterConfig } from './adapters/types.js';

const app = express();
const nluService = new NluService(env.ANTHROPIC_API_KEY);

// ── Slack adapter (the only messaging channel) ─────────────
const slackAdapter = new SlackAdapter(
  env.SLACK_BOT_TOKEN,
  env.SLACK_APP_TOKEN,
  nluService,
  env.SLACK_DEFAULT_CHANNEL,
);

// ── Adapter configs for cron push ──────────────────────────
const adapterConfigs: AdapterConfig[] = [
  {
    adapter: slackAdapter,
    getChannelIds: async () => [env.SLACK_DEFAULT_CHANNEL],
  },
];

// ── Health check (no auth required) ───────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── JSON parser for all routes ─────────────────────────────
app.use(express.json());

// ── Sentry error handler (must come after all routes) ─────
if (env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ── Start server ───────────────────────────────────────────
const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'Bot server started');

  // Start Slack Socket Mode
  void slackAdapter.start().catch((err) => {
    logger.error({ err }, 'Slack adapter failed to start');
  });

  // Start cron jobs after server is up (reads schedule from Redis config)
  void cronManager.init(adapterConfigs);
});

// ── Graceful shutdown ──────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down...');
  cronManager.stopAll();
  await slackAdapter.stop();
  server.close(async () => {
    await closeRedis();
    logger.info('Server closed');
    process.exitCode = 0;
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export default app;
