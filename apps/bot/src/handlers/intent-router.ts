import type { WebhookEvent } from '@line/bot-sdk';
import type { NluResult } from '../services/nlu/schema.js';
import type { ConversationState } from '../services/session.js';
import { handleQueryInventory } from './query-inventory.handler.js';
import { handleRestock } from './restock.handler.js';
import { handleResetItem } from './reset-item.handler.js';
import {
  handleStartOnboarding,
  handleOnboardingStep,
  handleResetConfirmed,
} from './onboarding.handler.js';
import {
  handleRecordConsumption,
  handleAnomalyConfirmation,
} from './record-consumption.handler.js';
import { handleQueryPurchaseList } from './query-purchase-list.handler.js';
import { handleReceiptConfirmation } from './receipt-import.handler.js';
import { handleRestockExpiryResponse } from './restock.handler.js';
import { clearSession } from '../services/session.js';
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
  if (session?.flow === 'RESET_CONFIRM') {
    if (nluResult.intent === 'CONFIRM_YES' || nluResult.rawText.trim() === '確認') {
      return handleResetConfirmed(sourceId);
    }
    if (nluResult.intent === 'CONFIRM_NO' || nluResult.rawText.trim() === '取消') {
      await clearSession(sourceId);
      return [{ type: 'text', text: '已取消，庫存未變動。' }];
    }
    // Any other message re-prompts the confirmation
    return [
      {
        type: 'text',
        text: '請傳「確認」清除並重新盤點，或傳「取消」放棄。',
      },
    ];
  }

  if (session?.flow === 'ONBOARDING') {
    if (nluResult.intent === 'START_ONBOARDING' || nluResult.intent === 'QUERY_INVENTORY') {
      return [{ type: 'text', text: '⏳ 盤點正在進行中，請繼續輸入物品，或傳「完成」結束盤點。' }];
    }
    return handleOnboardingStep(nluResult, session, sourceId);
  }

  // Receipt import confirmation flow
  if (session?.flow === 'RECEIPT_IMPORT') {
    if (nluResult.intent === 'CONFIRM_YES') {
      const result = await handleReceiptConfirmation(true, sourceId);
      if (result) return result;
    }
    if (nluResult.intent === 'CONFIRM_NO') {
      const result = await handleReceiptConfirmation(false, sourceId);
      if (result) return result;
    }
  }

  // Anomaly confirmation flow (RESTOCK_CONFIRM reused for consumption confirm)
  if (session?.flow === 'RESTOCK_CONFIRM') {
    if (nluResult.intent === 'CONFIRM_YES') {
      const result = await handleAnomalyConfirmation(true, sourceId);
      if (result) return result;
    }
    if (nluResult.intent === 'CONFIRM_NO') {
      const result = await handleAnomalyConfirmation(false, sourceId);
      if (result) return result;
    }
  }

  // Restock expiry clarification flow
  if (session?.flow === 'RESTOCK_EXPIRY') {
    return handleRestockExpiryResponse(nluResult, session, sourceId);
  }

  // ── Top-level intent dispatch ────────────────────────────
  switch (nluResult.intent) {
    case 'QUERY_INVENTORY':
      return handleQueryInventory(nluResult);

    case 'RESTOCK':
      return handleRestock(nluResult, sourceId);

    case 'RESET_ITEM':
      return handleResetItem(nluResult);

    case 'START_ONBOARDING':
      return handleStartOnboarding(sourceId);

    case 'RECORD_CONSUMPTION':
      return handleRecordConsumption(nluResult, sourceId);

    case 'QUERY_PURCHASE_LIST':
      return handleQueryPurchaseList();

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
