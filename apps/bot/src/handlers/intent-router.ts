import type { TextMessage, WebhookEvent } from '@line/bot-sdk';
import type { NluResult } from '../services/nlu/schema.js';
import type { ConversationState } from '../services/session.js';
import { logger } from '../lib/logger.js';

export interface RouterContext {
  event: WebhookEvent;
  nluResult: NluResult;
  session: ConversationState | null;
  sourceId: string; // groupId or userId
}

export type ReplyMessage = TextMessage | { type: 'text'; text: string };

/**
 * Routes a parsed NLU result to the appropriate handler.
 * Returns the reply message(s) to send back to LINE.
 */
export async function routeIntent(ctx: RouterContext): Promise<ReplyMessage[]> {
  const { nluResult, session } = ctx;

  // If we are mid-flow, delegate to the active flow handler
  if (session?.flow) {
    return handleActiveFlow(ctx);
  }

  switch (nluResult.intent) {
    case 'QUERY_INVENTORY':
      return [{ type: 'text', text: '📦 庫存查詢功能即將開放（Phase 3）' }];

    case 'RECORD_CONSUMPTION':
      return [{ type: 'text', text: '📝 消耗記錄功能即將開放（Phase 4）' }];

    case 'RESTOCK':
      return [{ type: 'text', text: '🛍️ 補充庫存功能即將開放（Phase 3）' }];

    case 'QUERY_PURCHASE_LIST':
      return [{ type: 'text', text: '🛒 採購清單功能即將開放（Phase 5）' }];

    case 'START_ONBOARDING':
      return [{ type: 'text', text: '📋 初始建檔功能即將開放（Phase 3）' }];

    case 'RESET_ITEM':
      return [{ type: 'text', text: '🔄 庫存重置功能即將開放（Phase 3）' }];

    case 'CONFIRM_YES':
    case 'CONFIRM_NO':
      return [{ type: 'text', text: '目前沒有待確認的操作。' }];

    case 'SET_CONFIG':
      return [{ type: 'text', text: '⚙️ 設定功能即將開放（Phase 6）' }];

    case 'UNKNOWN':
    default:
      logger.debug({ text: nluResult.rawText }, 'Unknown intent');
      return [
        {
          type: 'text',
          text: '抱歉，我不太明白您的意思 😅\n\n您可以說：\n• 「白米還有多少」查詢庫存\n• 「今天用了橄欖油半瓶」記錄消耗\n• 「買了青菜 3 包」補充庫存\n• 「我這週要買什麼」查詢採購清單',
        },
      ];
  }
}

async function handleActiveFlow(ctx: RouterContext): Promise<ReplyMessage[]> {
  const { session } = ctx;
  logger.debug({ flow: session?.flow, step: session?.step }, 'Handling active flow');
  // Flow handlers will be implemented in subsequent phases
  return [{ type: 'text', text: '流程處理中...' }];
}
