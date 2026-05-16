// instrument.ts must be the very first import so Sentry can patch express/http
// before they are loaded by any other module.
import './instrument.js';

import express from 'express';
import { createServer } from 'http';
import { messagingApi } from '@line/bot-sdk';
import * as Sentry from '@sentry/node';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeRedis } from './lib/redis.js';
import { lineSignatureMiddleware } from './middleware/line-signature.js';
import { NluService } from './services/nlu/nlu.service.js';
import { getRegisteredUsers } from './services/user-registry.service.js';
import { createWebhookRouter } from './routes/webhook.js';
import { cronManager } from './cron/cron-manager.js';
import { LineAdapter } from './adapters/line-adapter.js';
import { SlackAdapter } from './adapters/slack-adapter.js';
import type { AdapterConfig } from './adapters/types.js';

const app = express();
const nluService = new NluService(env.ANTHROPIC_API_KEY);

// ── LINE clients (shared across webhook + cron) ────────────
const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});
const lineAdapter = new LineAdapter(lineClient);

// ── Slack adapter (optional — only when tokens are configured) ────
const slackAdapter =
  env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN
    ? new SlackAdapter(env.SLACK_BOT_TOKEN, env.SLACK_APP_TOKEN, nluService)
    : null;

// ── Adapter configs for cron push ──────────────────────────
const adapterConfigs: AdapterConfig[] = [
  {
    adapter: lineAdapter,
    getChannelIds: async () => {
      const users = await getRegisteredUsers();
      return [...(env.LINE_GROUP_ID ? [env.LINE_GROUP_ID] : []), ...users];
    },
  },
  ...(slackAdapter && env.SLACK_DEFAULT_CHANNEL
    ? [
        {
          adapter: slackAdapter,
          getChannelIds: async () => (env.SLACK_DEFAULT_CHANNEL ? [env.SLACK_DEFAULT_CHANNEL] : []),
        } satisfies AdapterConfig,
      ]
    : []),
];

// ── Health check (no auth required) ───────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── LINE Webhook ───────────────────────────────────────────
// LINE sends JSON but signature validation requires the raw body.
// Strategy: capture raw body for /webhook, then parse to JSON.
// Note: middlewares registered via app.post(); router mounted via app.use()
// so that Express strips the '/webhook' prefix and router.post('/') matches.
app.post(
  '/webhook',
  // 1. Buffer the raw body for signature validation
  express.raw({ type: 'application/json' }),
  // 2. Verify LINE signature
  lineSignatureMiddleware(env.LINE_CHANNEL_SECRET),
  // 3. Parse the buffered body to JSON for downstream handlers
  (req, _res, next) => {
    try {
      req.body = JSON.parse((req.body as Buffer).toString('utf8')) as unknown;
      next();
    } catch (err) {
      next(err);
    }
  },
);

// 4. Mount the webhook router via app.use so Express strips '/webhook'
//    and router.post('/') inside the router matches correctly.
app.use('/webhook', createWebhookRouter(lineClient, nluService));

// ── Global JSON parser for all other routes ────────────────
app.use(express.json());

// ── Sentry error handler (must come after all routes) ─────
if (env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// ── Start server ───────────────────────────────────────────
const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'Bot server started');

  // Start Slack Socket Mode if configured
  if (slackAdapter) {
    void slackAdapter.start().catch((err) => {
      logger.error({ err }, 'Slack adapter failed to start');
    });
  }

  // Start cron jobs after server is up (reads schedule from Redis config)
  void cronManager.init(adapterConfigs);
});

// ── Graceful shutdown ──────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down...');
  cronManager.stopAll();
  if (slackAdapter) await slackAdapter.stop();
  server.close(async () => {
    await closeRedis();
    logger.info('Server closed');
    process.exitCode = 0;
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export default app;
