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
import { VisionService } from './services/vision.service.js';
import { createWebhookRouter } from './routes/webhook.js';
import { cronManager } from './cron/cron-manager.js';

const app = express();

// ── LINE clients (shared across webhook + cron) ────────────
const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

// Blob client is the separate client for downloading message content (images etc.)
const lineBlobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

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
app.use(
  '/webhook',
  createWebhookRouter(
    lineClient,
    lineBlobClient,
    new NluService(env.ANTHROPIC_API_KEY),
    new VisionService(env.ANTHROPIC_API_KEY),
  ),
);

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

  // Start cron jobs after server is up (reads schedule from Redis config)
  void cronManager.init(lineClient, env.LINE_GROUP_ID);
});

// ── Graceful shutdown ──────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down...');
  server.close(async () => {
    await closeRedis();
    logger.info('Server closed');
    process.exitCode = 0;
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export default app;
