import type { WebhookEvent } from '@line/bot-sdk';
import type { NluResult } from '../services/nlu/schema.js';
import type { ConversationState } from '../services/session.js';
import { handleQueryInventory } from './query-inventory.handler.js';
import { handleRestock } from './restock.handler.js';
import { handleResetItem } from './reset-item.handler.js';
import { handleStartOnboarding, handleOnboardingStep } from './onboarding.handler.js';
import { logger } from '../lib/logger.js';

export interface RouterContext {
  event: WebhookEvent;
  nluResult: NluResult;
  session: ConversationState | null;
  sourceId: string;
}

export type ReplyMessage = { type: 'text'; text: string };

/**
 * Routes a parsed NLU result to the appropriate handler.
 * Returns the reply message(s) to send back to LINE.
 */
export async function routeIntent(ctx: RouterContext): Promise<ReplyMessage[]> {
  const { nluResult, session, sourceId } = ctx;

  // ── Active multi-step flows ──────────────────────────────
  if (session?.flow === 'ONBOARDING') {
    return handleOnboardingStep(nluResult, session, sourceId);
  }

  // ── Top-level intent dispatch ────────────────────────────
  switch (nluResult.intent) {
    case 'QUERY_INVENTORY':
      return handleQueryInventory(nluResult);

    case 'RESTOCK':
      return handleRestock(nluResult);

    case 'RESET_ITEM':
      return handleResetItem(nluResult);

    case 'START_ONBOARDING':
      return handleStartOnboarding(sourceId);

    case 'RECORD_CONSUMPTION':
      return [{ type: 'text', text: '📝 消耗記錄功能即將開放（Phase 4）' }];

    case 'QUERY_PURCHASE_LIST':
      return [{ type: 'text', text: '🛒 採購清單功能即將開放（Phase 5）' }];

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
          text: '抱歉，我不太明白您的意思 😅\n\n您可以說：\n• 「白米還有多少」查詢庫存\n• 「今天用了橄欖油半瓶」記錄消耗\n• 「買了青菜 3 包」補充庫存\n• 「我這週要買什麼」查詢採購清單\n• 「開始盤點」建立庫存',
        },
      ];
  }
}
