import type { messagingApi } from '@line/bot-sdk';
import type { MessagingAdapter } from './types.js';
import type { ReplyMessage } from '../handlers/intent-router.js';
import { logger } from '../lib/logger.js';

export class LineAdapter implements MessagingAdapter {
  readonly platform = 'line' as const;

  constructor(private readonly client: messagingApi.MessagingApiClient) {}

  async push(channelId: string, messages: ReplyMessage[]): Promise<void> {
    if (messages.length === 0) return;
    try {
      await this.client.pushMessage({
        to: channelId,
        messages: messages as messagingApi.Message[],
      });
    } catch (err) {
      logger.error({ err, channelId }, 'LINE push failed');
    }
  }
}
