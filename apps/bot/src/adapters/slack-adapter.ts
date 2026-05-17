import { createRequire } from 'module';
import type {
  App as BoltApp,
  LogLevel as BoltLogLevel,
  BlockAction,
  ButtonAction,
} from '@slack/bolt';
import type { KnownBlock, ActionsBlock } from '@slack/types';
import type { MessagingAdapter } from './types.js';
import type { ReplyMessage, QuickReplyItem } from '../handlers/intent-router.js';
import { FEATURES_QUICK_REPLY_ITEMS } from '../handlers/intent-router.js';
import type { NluService } from '../services/nlu/nlu.service.js';
import { processTextMessage } from '../routes/message-processor.js';
import { logger } from '../lib/logger.js';

// @slack/bolt v3 is CJS-only. Use createRequire so Node.js v20's ESM loader
// doesn't reject the named exports that CJS interop can't reliably surface.
const _require = createRequire(import.meta.url);
const boltModule = _require('@slack/bolt') as {
  App: new (...args: ConstructorParameters<typeof BoltApp>) => BoltApp;
  LogLevel: typeof BoltLogLevel;
};
const { App, LogLevel } = boltModule;

const QUICK_REPLY_ACTION_PREFIX = 'quick_reply_';
const HOME_ACTION_PREFIX = 'home_action_';

function buildHomeView(): { type: 'home'; blocks: KnownBlock[] } {
  const actionButtons: ActionsBlock = {
    type: 'actions',
    elements: FEATURES_QUICK_REPLY_ITEMS.map((item: QuickReplyItem, idx: number) => ({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: item.action.label, emoji: false },
      value: item.action.text,
      action_id: `${HOME_ACTION_PREFIX}${idx}`,
    })),
  };
  return {
    type: 'home',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*👋 居家生活小幫手*\n點選下方按鈕快速開始，或直接傳訊息給我 😊',
        },
      },
      { type: 'divider' },
      actionButtons,
    ],
  };
}

function toSlackBlocks(msg: ReplyMessage): KnownBlock[] {
  const blocks: KnownBlock[] = [{ type: 'section', text: { type: 'mrkdwn', text: msg.text } }];

  if (msg.quickReply && msg.quickReply.items.length > 0) {
    const actionsBlock: ActionsBlock = {
      type: 'actions',
      elements: msg.quickReply.items.map((item: QuickReplyItem, idx: number) => ({
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: item.action.label, emoji: false },
        value: item.action.text,
        action_id: `${QUICK_REPLY_ACTION_PREFIX}${idx}`,
      })),
    };
    blocks.push(actionsBlock);
  }

  return blocks;
}

export class SlackAdapter implements MessagingAdapter {
  readonly platform = 'slack' as const;
  private readonly app: BoltApp;

  constructor(
    botToken: string,
    appToken: string,
    private readonly nluService: NluService,
    private readonly defaultChannelId?: string,
  ) {
    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });
    this.registerHandlers();
  }

  async start(): Promise<void> {
    await this.app.start();
    logger.info('Slack Socket Mode connected');
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  async push(channelId: string, messages: ReplyMessage[]): Promise<void> {
    for (const msg of messages) {
      try {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: msg.text,
          blocks: toSlackBlocks(msg),
        });
      } catch (err) {
        logger.error({ err, channelId }, 'Slack push failed');
      }
    }
  }

  private async handleText(
    channelId: string,
    rawText: string,
    say: (msg: string | { text: string; blocks: KnownBlock[] }) => Promise<unknown>,
  ): Promise<void> {
    const text = rawText.trim();
    if (!text) return;
    try {
      const replies = await processTextMessage(text, channelId, this.nluService);
      for (const reply of replies) {
        await say({ text: reply.text, blocks: toSlackBlocks(reply) });
      }
    } catch (err) {
      logger.error({ err, channelId, text }, 'Slack message processing error');
      await say('系統暫時無法處理您的請求，請稍後再試 🙏');
    }
  }

  private registerHandlers(): void {
    // Publish the feature menu to App Home whenever a user opens it
    this.app.event('app_home_opened', async ({ event, client }) => {
      try {
        await client.views.publish({
          user_id: event.user,
          view: buildHomeView(),
        });
      } catch (err) {
        logger.error({ err, userId: event.user }, 'Failed to publish App Home view');
      }
    });

    // Handle feature button clicks from App Home — respond in default channel
    this.app.action(new RegExp(`^${HOME_ACTION_PREFIX}`), async ({ body, ack, client }) => {
      await ack();
      const actionBody = body as BlockAction<ButtonAction>;
      const value = actionBody.actions[0]?.value;
      const userId = actionBody.user.id;
      if (!value || !userId) return;

      const targetChannel = this.defaultChannelId;
      if (!targetChannel) return;

      try {
        const replies = await processTextMessage(value, targetChannel, this.nluService);
        for (const reply of replies) {
          await client.chat.postMessage({
            channel: targetChannel,
            text: reply.text,
            blocks: toSlackBlocks(reply),
          });
        }
      } catch (err) {
        logger.error({ err, userId, value }, 'App Home action processing error');
      }
    });

    // Handle plain text messages from users (message.channels / message.im events)
    this.app.message(async ({ message, say }) => {
      if (message.subtype !== undefined || !('text' in message) || !message.text) {
        return;
      }
      await this.handleText(message.channel, message.text, say);
    });

    // Also handle @mentions (app_mention event) so the bot works even without
    // message.channels subscription
    this.app.event('app_mention', async ({ event, say }) => {
      // Strip the leading @mention token before processing
      const text = event.text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();
      if (!text) return;
      await this.handleText(event.channel, text, say);
    });

    // Handle quick-reply button clicks
    this.app.action(new RegExp(`^${QUICK_REPLY_ACTION_PREFIX}`), async ({ body, ack, client }) => {
      await ack();

      const actionBody = body as BlockAction<ButtonAction>;
      const action = actionBody.actions[0];
      const value = action?.value;
      if (!value) return;

      const channelId = actionBody.channel?.id;
      if (!channelId) return;

      // Remove buttons from the original message to prevent re-clicking
      if (actionBody.message?.ts) {
        try {
          await client.chat.update({
            channel: channelId,
            ts: actionBody.message.ts,
            text: actionBody.message.text ?? value,
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: actionBody.message.text ?? value },
              },
            ],
          });
        } catch {
          // Non-critical — continue even if update fails
        }
      }

      try {
        const replies = await processTextMessage(value, channelId, this.nluService);
        for (const reply of replies) {
          await client.chat.postMessage({
            channel: channelId,
            text: reply.text,
            blocks: toSlackBlocks(reply),
          });
        }
      } catch (err) {
        logger.error({ err, channelId, value }, 'Slack action processing error');
        await client.chat.postMessage({
          channel: channelId,
          text: '系統暫時無法處理您的請求，請稍後再試 🙏',
        });
      }
    });
  }
}
