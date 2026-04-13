import type { WebhookEvent, TextEventMessage } from '@line/bot-sdk';
import type { messagingApi } from '@line/bot-sdk';
import type { Router, Request, Response } from 'express';
import { Router as createRouter } from 'express';
import type { NluService } from '../services/nlu/nlu.service.js';
import { getSession } from '../services/session.js';
import { routeIntent } from '../handlers/intent-router.js';
import { logger } from '../lib/logger.js';

type LineClient = messagingApi.MessagingApiClient;

export function createWebhookRouter(lineClient: LineClient, nluService: NluService): Router {
  const router = createRouter();

  router.post('/', async (req: Request, res: Response): Promise<void> => {
    // Signature already verified by middleware — body has been parsed from raw Buffer
    const body = req.body as { events: WebhookEvent[]; destination: string };

    logger.debug({ destination: body.destination, count: body.events.length }, 'Webhook received');

    // Respond immediately — LINE requires 200 within 5 seconds
    res.sendStatus(200);

    await Promise.all(body.events.map((event) => processEvent(event, lineClient, nluService)));
  });

  return router;
}

async function processEvent(
  event: WebhookEvent,
  lineClient: LineClient,
  nluService: NluService,
): Promise<void> {
  if (event.type !== 'message' || event.message.type !== 'text') {
    // Only handle text messages in Phase 2; image handling added in Phase 7
    return;
  }

  const textMessage = event.message as TextEventMessage;
  const sourceId =
    event.source.type === 'group'
      ? event.source.groupId
      : event.source.type === 'user'
        ? event.source.userId
        : null;

  if (!sourceId) {
    logger.warn({ source: event.source }, 'Cannot determine sourceId');
    return;
  }

  const replyToken = event.replyToken;
  const text = textMessage.text.trim();

  logger.info({ sourceId, text }, 'Processing text message');

  try {
    const [nluResult, session] = await Promise.all([nluService.parse(text), getSession(sourceId)]);

    const replies = await routeIntent({ event, nluResult, session, sourceId });

    if (replies.length > 0) {
      await lineClient.replyMessage({
        replyToken,
        messages: replies as messagingApi.Message[],
      });
    }
  } catch (err) {
    logger.error({ err, sourceId, text }, 'Error processing message');

    // Best-effort error reply — may fail if replyToken has already expired
    try {
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: '系統暫時無法處理您的請求，請稍後再試 🙏' }],
      });
    } catch {
      // Ignore — token may have expired
    }
  }
}
