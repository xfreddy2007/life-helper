import type { WebhookEvent, TextEventMessage, ImageEventMessage } from '@line/bot-sdk';
import type { messagingApi } from '@line/bot-sdk';
import type { Readable } from 'node:stream';
import type { Router, Request, Response } from 'express';
import { Router as createRouter } from 'express';
import type { NluService } from '../services/nlu/nlu.service.js';
import type { VisionService, ImageMediaType } from '../services/vision.service.js';
import { getSession } from '../services/session.js';
import { routeIntent, buildFeaturesMenu } from '../handlers/intent-router.js';
import { registerUser } from '../services/user-registry.service.js';
import { handleReceiptImageResult } from '../handlers/receipt-import.handler.js';
import { logger } from '../lib/logger.js';

type LineClient = messagingApi.MessagingApiClient;
type LineBlobClient = messagingApi.MessagingApiBlobClient;

export function createWebhookRouter(
  lineClient: LineClient,
  lineBlobClient: LineBlobClient,
  nluService: NluService,
  visionService: VisionService,
): Router {
  const router = createRouter();

  router.post('/', async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { events: WebhookEvent[]; destination: string };
    logger.debug({ destination: body.destination, count: body.events.length }, 'Webhook received');

    // Respond immediately — LINE requires 200 within 5 seconds
    res.sendStatus(200);

    await Promise.all(
      body.events.map((event) =>
        processEvent(event, lineClient, lineBlobClient, nluService, visionService),
      ),
    );
  });

  return router;
}

async function processEvent(
  event: WebhookEvent,
  lineClient: LineClient,
  lineBlobClient: LineBlobClient,
  nluService: NluService,
  visionService: VisionService,
): Promise<void> {
  // ── Follow event → register user + welcome message ──────────
  if (event.type === 'follow') {
    const userId = event.source.type === 'user' ? event.source.userId : null;
    if (userId) {
      await registerUser(userId);
      await lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [buildFeaturesMenu() as messagingApi.Message],
      });
    }
    return;
  }

  if (event.type !== 'message') return;

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

  // Register individual users so cron jobs can push to their 1:1 chat
  if (event.source.type === 'user') {
    await registerUser(event.source.userId);
  }

  const replyToken = event.replyToken;

  // ── Image message → receipt recognition ─────────────────────
  if (event.message.type === 'image') {
    await processImageMessage(
      event.message as ImageEventMessage,
      replyToken,
      sourceId,
      lineClient,
      lineBlobClient,
      visionService,
    );
    return;
  }

  // ── Text message → NLU intent routing ───────────────────────
  if (event.message.type !== 'text') return;

  const textMessage = event.message as TextEventMessage;
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
    logger.error({ err, sourceId, text }, 'Error processing text message');
    await safeReply(lineClient, replyToken, '系統暫時無法處理您的請求，請稍後再試 🙏');
  }
}

async function processImageMessage(
  message: ImageEventMessage,
  replyToken: string,
  sourceId: string,
  lineClient: LineClient,
  lineBlobClient: LineBlobClient,
  visionService: VisionService,
): Promise<void> {
  logger.info({ sourceId, messageId: message.id }, 'Processing image message');

  try {
    // Download image from LINE's blob content API
    const stream = await lineBlobClient.getMessageContent(message.id);
    const imageBuffer = await nodeReadableToBuffer(stream);
    const imageBase64 = imageBuffer.toString('base64');

    // LINE image messages are JPEG unless from an external provider
    const mediaType: ImageMediaType = 'image/jpeg';

    const visionResult = await visionService.recognizeReceipt(imageBase64, mediaType);
    const replies = await handleReceiptImageResult(visionResult.items, sourceId);

    await lineClient.replyMessage({
      replyToken,
      messages: replies as messagingApi.Message[],
    });
  } catch (err) {
    logger.error({ err, sourceId }, 'Error processing image message');
    await safeReply(lineClient, replyToken, '圖片辨識失敗，請重新傳送或改用文字補貨 🙏');
  }
}

// ── Utilities ─────────────────────────────────────────────────

/** Buffer a Node.js Readable stream into a Buffer. */
async function nodeReadableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function safeReply(lineClient: LineClient, replyToken: string, text: string): Promise<void> {
  try {
    await lineClient.replyMessage({ replyToken, messages: [{ type: 'text', text }] });
  } catch {
    // Reply token may have expired — ignore
  }
}
