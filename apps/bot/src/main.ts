import * as Sentry from '@sentry/node';
import express from 'express';
import { createServer } from 'http';
import { messagingApi } from '@line/bot-sdk';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeRedis } from './lib/redis.js';
import { lineSignatureMiddleware } from './middleware/line-signature.js';
import { NluService } from './services/nlu/nlu.service.js';
import { VisionService } from './services/vision.service.js';
import { createWebhookRouter } from './routes/webhook.js';
import { scheduleWeeklyPurchaseReminder } from './cron/weekly-purchase.cron.js';
import { scheduleDailyConfirmCrons } from './cron/daily-confirm.cron.js';
import { scheduleExpiryAlertCron } from './cron/expiry-alert.cron.js';

// ── Sentry — must initialise before any other imports use it ──
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
  });
  logger.info('Sentry initialised');
}

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
  // 4. Webhook router
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

  // Start cron jobs after server is up
  scheduleWeeklyPurchaseReminder(lineClient, env.LINE_GROUP_ID);
  scheduleDailyConfirmCrons(lineClient, env.LINE_GROUP_ID);
  scheduleExpiryAlertCron(lineClient, env.LINE_GROUP_ID);
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
