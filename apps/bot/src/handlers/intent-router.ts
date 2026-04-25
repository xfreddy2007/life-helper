import type { WebhookEvent } from '@line/bot-sdk';
import type { Intent, NluResult } from '../services/nlu/schema.js';
import type { ConversationFlow, ConversationState } from '../services/session.js';
import { handleQueryInventory } from './query-inventory.handler.js';
import { handleRestock } from './restock.handler.js';
import { handleResetItem } from './reset-item.handler.js';
import {
  handleStartOnboarding,
  handleOnboardingStep,
  handleResetConfirmed,
  handlePartialReset,
  handlePartialResetConfirmed,
} from './onboarding.handler.js';
import {
  handleRecordConsumption,
  handleAnomalyConfirmation,
} from './record-consumption.handler.js';
import { handleQueryPurchaseList } from './query-purchase-list.handler.js';
import { handleReceiptConfirmation, handleReceiptCorrection } from './receipt-import.handler.js';
import { handleRestockExpiryResponse } from './restock.handler.js';
import { handleRevertOperation, handleRevertSelect } from './revert.handler.js';
import { handleSetConfig } from './set-config.handler.js';
import { handlePurgeExpired, handlePurgeExpiredFlow } from './purge-expired.handler.js';
import { clearSession, setSession } from '../services/session.js';
import { logger } from '../lib/logger.js';

export interface RouterContext {
  event: WebhookEvent;
  nluResult: NluResult;
  session: ConversationState | null;
  sourceId: string;
}

export type QuickReplyItem = {
  type: 'action';
  action: { type: 'message'; label: string; text: string };
};

export type ReplyMessage = {
  type: 'text';
  text: string;
  quickReply?: { items: QuickReplyItem[] };
};

// Intents that are always allowed through regardless of active session.
// Everything else triggers the conflict guard when a session is running.
const SESSION_PASSTHROUGH_INTENTS = new Set<Intent>([
  'UNKNOWN', // unrecognised text — let the session handler re-prompt naturally
  'CONFIRM_YES', // session confirmations are handled inside each flow block
  'CONFIRM_NO',
  'QUERY_INVENTORY', // read-only queries are harmless mid-session
  'QUERY_PURCHASE_LIST',
  'SHOW_FEATURES', // informational — safe to show at any time
]);

// Human-readable label for each intent that can be pending in SESSION_INTERRUPT.
const INTENT_LABELS: Partial<Record<Intent, string>> = {
  START_ONBOARDING: '庫存盤點',
  RESTOCK: '補充庫存',
  RESET_ITEM: '重置庫存',
  PARTIAL_RESET: '部分庫存重置',
  REVERT_OPERATION: '撤銷操作',
  RECORD_CONSUMPTION: '記錄消耗',
  SET_CONFIG: '排程設定',
  PURGE_EXPIRED: '清理過期品',
};

// Human-readable label for each active flow, used in conflict messages.
const FLOW_LABELS: Partial<Record<ConversationFlow, string>> = {
  ONBOARDING: '庫存盤點',
  RESET_CONFIRM: '全量庫存重置確認',
  RECEIPT_IMPORT: '收據匯入確認',
  RESTOCK_CONFIRM: '補貨異常確認',
  RESTOCK_EXPIRY: '補充庫存',
  REVERT_SELECT: '撤銷操作',
  PARTIAL_RESET_CONFIRM: '部分庫存重置確認',
  PURGE_EXPIRED: '清理過期品',
};

// Returns true for (flow, intent) pairs that are continuations of the same flow —
// these should not trigger the conflict guard.
function isSameContinuation(flow: ConversationFlow, intent: Intent): boolean {
  // ONBOARDING already shows its own "in progress" message for START_ONBOARDING
  if (flow === 'ONBOARDING' && intent === 'START_ONBOARDING') return true;
  // RESTOCK_EXPIRY routes RESTOCK back through handleRestockExpiryResponse
  if (flow === 'RESTOCK_EXPIRY' && intent === 'RESTOCK') return true;
  return false;
}

const FEATURES_QUICK_REPLY_ITEMS: QuickReplyItem[] = [
  { type: 'action', action: { type: 'message', label: '庫存盤點', text: '開始盤點' } },
  { type: 'action', action: { type: 'message', label: '查詢庫存', text: '查詢庫存' } },
  { type: 'action', action: { type: 'message', label: '記錄消耗', text: '記錄消耗' } },
  { type: 'action', action: { type: 'message', label: '補充庫存', text: '補充庫存' } },
  { type: 'action', action: { type: 'message', label: '採購清單', text: '採購清單' } },
  { type: 'action', action: { type: 'message', label: '清理過期品', text: '清理過期品' } },
  { type: 'action', action: { type: 'message', label: '重置庫存', text: '重置庫存' } },
  { type: 'action', action: { type: 'message', label: '撤銷操作', text: '撤銷操作' } },
  { type: 'action', action: { type: 'message', label: '設定排程', text: '設定排程' } },
];

export function buildFeaturesMenu(): ReplyMessage {
  return {
    type: 'text',
    text: '👋 我是居家生活小幫手！以下是我能做的事，點選按鈕快速開始，或直接用文字告訴我 😊',
    quickReply: { items: FEATURES_QUICK_REPLY_ITEMS },
  };
}

/**
 * Routes a parsed NLU result to the appropriate handler.
 * Returns the reply message(s) to send back to LINE.
 */
export async function routeIntent(ctx: RouterContext): Promise<ReplyMessage[]> {
  const { event, nluResult, session, sourceId } = ctx;

  // ── Session conflict guard ───────────────────────────────────
  // When a user triggers a new major action while another session is active,
  // pause and ask for confirmation before discarding the ongoing flow.
  if (
    session &&
    session.flow !== 'SESSION_INTERRUPT' &&
    !SESSION_PASSTHROUGH_INTENTS.has(nluResult.intent) &&
    !isSameContinuation(session.flow as ConversationFlow, nluResult.intent)
  ) {
    const currentLabel = FLOW_LABELS[session.flow as ConversationFlow] ?? '目前操作';

    await setSession(sourceId, {
      flow: 'SESSION_INTERRUPT',
      step: 0,
      data: {
        previousSession: session,
        pendingNluJson: JSON.stringify(nluResult),
      },
      // Short TTL — user must respond within 5 minutes
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return [
      {
        type: 'text',
        text:
          `⚠️ 您目前有「${currentLabel}」正在進行中。\n\n` +
          `要放棄目前操作並開始新的動作嗎？\n` +
          `• 傳「確認」放棄目前操作\n` +
          `• 傳「取消」繼續目前操作`,
      },
    ];
  }

  // ── SESSION_INTERRUPT resolution ────────────────────────────
  if (session?.flow === 'SESSION_INTERRUPT') {
    if (nluResult.intent === 'CONFIRM_YES' || nluResult.rawText.trim() === '確認') {
      // Discard previous session and execute the pending intent
      await clearSession(sourceId);
      const pendingNlu = JSON.parse(session.data.pendingNluJson as string) as NluResult;
      const switchLabel = INTENT_LABELS[pendingNlu.intent] ?? '新操作';
      const pendingReplies = await routeIntent({ ...ctx, nluResult: pendingNlu, session: null });
      return [{ type: 'text', text: `好的，已切換至「${switchLabel}」。` }, ...pendingReplies];
    }
    if (nluResult.intent === 'CONFIRM_NO' || nluResult.rawText.trim() === '取消') {
      // Restore previous session and let the user continue
      const previousSession = session.data.previousSession as ConversationState;
      await setSession(sourceId, previousSession);
      const currentLabel = FLOW_LABELS[previousSession.flow as ConversationFlow] ?? '目前操作';
      return [{ type: 'text', text: `好的，已繼續「${currentLabel}」，請繼續操作。` }];
    }
    return [
      {
        type: 'text',
        text: '請傳「確認」放棄目前操作，或傳「取消」繼續目前操作。',
      },
    ];
  }

  // ── SHOW_FEATURES always returns the menu, regardless of active session ──
  if (nluResult.intent === 'SHOW_FEATURES') {
    return [buildFeaturesMenu()];
  }

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
    // Try to parse as a quantity correction (e.g. "可口可樂330ml 6瓶")
    const rawText =
      event.type === 'message' && event.message.type === 'text' ? event.message.text.trim() : '';
    const correctionResult = await handleReceiptCorrection(rawText, sourceId);
    if (correctionResult) return correctionResult;
    return [
      {
        type: 'text',
        text: '請傳「確認」匯入收據，或傳「取消」放棄。\n如需修正數量，回覆如：「可口可樂330ml 6瓶」',
      },
    ];
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
    return [{ type: 'text', text: '請傳「確認」記錄此消耗，或傳「取消」放棄。' }];
  }

  // Restock expiry clarification flow
  if (session?.flow === 'RESTOCK_EXPIRY') {
    return handleRestockExpiryResponse(nluResult, session, sourceId);
  }

  // Revert operation selection flow
  if (session?.flow === 'REVERT_SELECT') {
    return handleRevertSelect(nluResult.rawText, sourceId);
  }

  // Partial reset confirmation flow
  if (session?.flow === 'PARTIAL_RESET_CONFIRM') {
    if (nluResult.intent === 'CONFIRM_YES' || nluResult.rawText.trim() === '確認') {
      return handlePartialResetConfirmed(sourceId);
    }
    if (nluResult.intent === 'CONFIRM_NO' || nluResult.rawText.trim() === '取消') {
      await clearSession(sourceId);
      return [{ type: 'text', text: '已取消，庫存未變動。' }];
    }
    return [{ type: 'text', text: '請傳「確認」繼續重置，或傳「取消」放棄。' }];
  }

  // Purge expired items flow (step 0: selection, step 1: confirmation)
  if (session?.flow === 'PURGE_EXPIRED') {
    return handlePurgeExpiredFlow(nluResult, session, sourceId);
  }

  // ── Top-level intent dispatch ────────────────────────────
  switch (nluResult.intent) {
    case 'QUERY_INVENTORY':
      return handleQueryInventory(nluResult);

    case 'RESTOCK':
      return handleRestock(nluResult, sourceId);

    case 'RESET_ITEM':
      return handleResetItem(nluResult, sourceId);

    case 'PARTIAL_RESET':
      return handlePartialReset(nluResult, sourceId);

    case 'START_ONBOARDING':
      return handleStartOnboarding(sourceId);

    case 'RECORD_CONSUMPTION':
      return handleRecordConsumption(nluResult, sourceId);

    case 'QUERY_PURCHASE_LIST':
      return handleQueryPurchaseList();

    case 'CONFIRM_YES':
    case 'CONFIRM_NO':
      return [{ type: 'text', text: '目前沒有待確認的操作。' }];

    case 'REVERT_OPERATION':
      return handleRevertOperation(sourceId);

    case 'SET_CONFIG':
      return handleSetConfig(nluResult);

    case 'PURGE_EXPIRED':
      return handlePurgeExpired(sourceId);

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
