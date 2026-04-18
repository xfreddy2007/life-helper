import {
  listCategories,
  listItems,
  findCategoryByName,
  getDefaultCategory,
  findOrCreateItem,
  addStock,
  resetAllInventory,
  findItemByName,
  resetQuantity,
} from '@life-helper/database/repositories';
import { getSession, setSession, clearSession, newSession } from '../services/session.js';
import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';
import type { ConversationState } from '../services/session.js';

// ── Types ──────────────────────────────────────────────────────

interface PendingExpiryItem {
  name: string;
  quantity: number;
  unit: string;
  categoryId: string;
}

// ── Public handlers ────────────────────────────────────────────

/**
 * Step 0 — Initiated by START_ONBOARDING intent.
 * Skips confirmation when inventory is already empty; otherwise asks first.
 */
export async function handleStartOnboarding(sourceId: string): Promise<ReplyMessage[]> {
  const existing = await listItems();
  if (existing.length === 0) {
    return beginOnboarding(sourceId);
  }

  const state = newSession('RESET_CONFIRM');
  await setSession(sourceId, state);

  return [
    {
      type: 'text',
      text: '⚠️ 重置庫存將清除所有現有庫存記錄，此操作無法復原。\n\n確認要繼續嗎？\n• 傳「確認」清除並開始重新盤點\n• 傳「取消」放棄',
    },
  ];
}

/**
 * Called after user confirms reset.
 * Clears all inventory then starts the onboarding flow.
 */
export async function handleResetConfirmed(sourceId: string): Promise<ReplyMessage[]> {
  await resetAllInventory();
  return beginOnboarding(sourceId, true);
}

/**
 * Step 1+ — User is entering items during onboarding.
 * Also handles the expiry-date clarification sub-flow.
 */
export async function handleOnboardingStep(
  nlu: NluResult,
  session: ConversationState,
  sourceId: string,
): Promise<ReplyMessage[]> {
  // ── Expiry-date clarification sub-flow ───────────────────
  const pendingQueue = (session.data.pendingExpiryQueue ?? []) as PendingExpiryItem[];
  if (pendingQueue.length > 0) {
    return handleExpiryDateResponse(nlu, session, pendingQueue, sourceId);
  }

  // ── "完成" / cancel ──────────────────────────────────────
  if (nlu.intent === 'CONFIRM_YES' || nlu.rawText.trim() === '完成') {
    await clearSession(sourceId);
    return [{ type: 'text', text: '✅ 盤點完成！\n\n傳「查詢庫存」查看剛才建立的記錄 😊' }];
  }

  if (nlu.intent === 'CONFIRM_NO') {
    await clearSession(sourceId);
    return [{ type: 'text', text: '已取消盤點。' }];
  }

  // ── Item input ───────────────────────────────────────────
  const itemEntities = nlu.entities.items;
  if (!itemEntities || itemEntities.length === 0) {
    return [
      {
        type: 'text',
        text: '請輸入物品格式：「物品名稱 數量 單位 有效日期」\n例如：「白米 5 kg 2027/06」\n\n輸入「完成」結束盤點。',
      },
    ];
  }

  const results: string[] = [];
  const newPendingQueue: PendingExpiryItem[] = [];
  const afterReset = Boolean(session.data.afterReset);

  for (const entity of itemEntities) {
    const { name, quantity, unit, expiryDate, expiryDays } = entity;
    if (!name || quantity == null || !unit) {
      results.push(`⚠️ 格式不正確，請重新輸入`);
      continue;
    }

    if (entity.unitMismatch) {
      const hint = entity.suggestedUnit ? `（建議使用「${entity.suggestedUnit}」）` : '';
      results.push(`⚠️ 「${name}」使用「${unit}」作為單位不太合理${hint}，請重新輸入`);
      continue;
    }

    const categoryName = nlu.entities.category;
    const category = categoryName
      ? ((await findCategoryByName(categoryName)) ?? (await getDefaultCategory()))
      : await getDefaultCategory();

    if (!category) {
      results.push(`❌ 找不到分類，無法建立「${name}」`);
      continue;
    }

    // Resolve expiry
    let resolvedExpiry: Date | undefined;
    if (expiryDate) {
      resolvedExpiry = new Date(expiryDate);
    } else if (expiryDays != null) {
      resolvedExpiry = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    }

    if (resolvedExpiry) {
      // Past-date check (skip when after a reset)
      if (!afterReset && resolvedExpiry < todayMidnight()) {
        results.push(
          `⚠️ 「${name}」的到期日 ${fmtDate(resolvedExpiry)} 已過期，請重新提供有效到期日`,
        );
        newPendingQueue.push({ name, quantity, unit, categoryId: category.id });
        continue;
      }
      // Expiry valid → save immediately
      const { item, created } = await findOrCreateItem(name, category.id, [unit]);
      await addStock(item.id, { quantity, unit, expiryDate: resolvedExpiry });
      const tag = created ? '（新建立）' : '（已更新）';
      results.push(`✅ ${name} ${quantity}${unit} ${tag}`);
    } else {
      // No expiry → queue for clarification
      newPendingQueue.push({ name, quantity, unit, categoryId: category.id });
    }
  }

  const hasDone = /(?:^|\s)完成(?:\s|$)/.test(nlu.rawText);

  // If any items are missing expiry dates, ask for the first one
  if (newPendingQueue.length > 0) {
    const first = newPendingQueue[0]!;
    const updatedSession: ConversationState = {
      ...session,
      step: session.step + 1,
      data: { pendingExpiryQueue: newPendingQueue, completionPending: hasDone },
    };
    await setSession(sourceId, updatedSession);

    const prefix = results.length > 0 ? `${results.join('\n')}\n\n` : '';
    return [
      {
        type: 'text',
        text: `${prefix}❓ 「${first.name}」的到期日是？（格式：YYYY/MM 或 YYYY/MM/DD）\n\n若無到期日請傳「跳過」`,
      },
    ];
  }

  // All items had expiry dates — check for inline "完成"
  if (hasDone) {
    await clearSession(sourceId);
    return [
      {
        type: 'text',
        text: `${results.join('\n')}\n\n✅ 盤點完成！\n\n傳「查詢庫存」查看剛才建立的記錄 😊`,
      },
    ];
  }

  const updatedSession: ConversationState = { ...session, step: session.step + 1 };
  await setSession(sourceId, updatedSession);
  return [
    {
      type: 'text',
      text: `${results.join('\n')}\n\n繼續輸入下一項，或傳「完成」結束盤點。`,
    },
  ];
}

/**
 * Initiated by PARTIAL_RESET intent.
 * Shows current stock for each named item and asks for confirmation.
 */
export async function handlePartialReset(
  nlu: NluResult,
  sourceId: string,
): Promise<ReplyMessage[]> {
  const itemNames = (nlu.entities.items ?? []).map((e) => e.name).filter(Boolean) as string[];

  if (itemNames.length === 0) {
    return [
      {
        type: 'text',
        text: '請指定要重置的物品，例如：\n「重置庫存 牛奶 可樂」',
      },
    ];
  }

  const itemLines: string[] = [];
  for (const name of itemNames) {
    const item = await findItemByName(name);
    if (item) {
      const qty = `${+item.totalQuantity.toFixed(2)}${item.units[0] ?? ''}`;
      itemLines.push(`• ${name}（目前 ${qty}）`);
    } else {
      itemLines.push(`• ${name}（找不到此物品）`);
    }
  }

  const state = newSession('PARTIAL_RESET_CONFIRM');
  state.data = { itemNames };
  await setSession(sourceId, state);

  return [
    {
      type: 'text',
      text: `⚠️ 確認要重置以下物品的庫存嗎？\n\n${itemLines.join('\n')}\n\n此操作將清除所選物品的所有批次記錄。\n• 傳「確認」繼續\n• 傳「取消」放棄`,
    },
  ];
}

/**
 * Called after user confirms partial reset.
 * Reads item names from session, resets each to 0, then clears session.
 */
export async function handlePartialResetConfirmed(sourceId: string): Promise<ReplyMessage[]> {
  const session = await getSession(sourceId);
  const itemNames = (session?.data.itemNames as string[] | undefined) ?? [];
  await clearSession(sourceId);

  const results: string[] = [];
  for (const name of itemNames) {
    const item = await findItemByName(name);
    if (!item) {
      results.push(`⚠️ 找不到「${name}」，略過`);
      continue;
    }
    await resetQuantity(item.id, 0, item.units[0] ?? '');
    results.push(`🔄 已清空「${name}」`);
  }

  return [
    {
      type: 'text',
      text: `${results.join('\n')}\n\n可傳「補充庫存」或「${itemNames[0] ?? '牛奶'} 2 瓶 2026/12」重新登記庫存。`,
    },
  ];
}

// ── Private helpers ────────────────────────────────────────────

/**
 * Sets up the ONBOARDING session and returns the opening prompt.
 */
async function beginOnboarding(sourceId: string, afterReset = false): Promise<ReplyMessage[]> {
  const categories = await listCategories();
  const catList = categories.map((c) => `• ${c.name}`).join('\n');

  const state = newSession('ONBOARDING');
  state.step = 1;
  state.data = { afterReset };
  await setSession(sourceId, state);

  const prefix = afterReset ? '✅ 庫存已清除。\n\n' : '';
  return [
    {
      type: 'text',
      text: `${prefix}📋 開始盤點！\n\n請依序輸入家中現有物品，格式：\n「物品名稱 數量 單位 有效日期」\n\n例如：\n• 白米 5 kg 2027/06\n• 橄欖油 2 瓶 2026/12/31\n• 廚房紙巾 3 包\n\n可用分類：\n${catList}\n\n輸入「完成」結束盤點。`,
    },
  ];
}

/**
 * Handles a user reply when we're waiting for an expiry date.
 * Accepts a date string, "跳過", "下一項", "完成", or re-prompts on unrecognized input.
 */
async function handleExpiryDateResponse(
  nlu: NluResult,
  session: ConversationState,
  queue: PendingExpiryItem[],
  sourceId: string,
): Promise<ReplyMessage[]> {
  const current = queue[0]!;
  const remaining = queue.slice(1);
  const completionPending = Boolean(session.data.completionPending);
  const trimmed = nlu.rawText.trim();

  // Check if user wants to complete all
  const wantsDone =
    trimmed === '完成' ||
    (nlu.intent === 'CONFIRM_YES' && remaining.length === 0 && completionPending);

  // Try to parse an explicit date
  const parsedDate = tryParseDate(trimmed);

  // Recognised "proceed without date" keywords
  const isSkip = /跳過|沒有|無|不知道/.test(trimmed);
  const isNext = /下一項|下一个|下一步|繼續/.test(trimmed);

  const afterReset = Boolean(session.data.afterReset);

  // None of the above → ask again without advancing
  if (!parsedDate && !isSkip && !isNext && !wantsDone) {
    return [
      {
        type: 'text',
        text: `❓ 「${current.name}」的到期日是？（格式：YYYY/MM 或 YYYY/MM/DD）\n\n若無到期日請傳「跳過」`,
      },
    ];
  }

  // Past-date check (skip when after a reset)
  if (parsedDate && !afterReset && parsedDate < todayMidnight()) {
    return [
      {
        type: 'text',
        text: `❌ 到期日 ${fmtDate(parsedDate)} 已是過去的日期，請重新輸入有效到期日。\n\n若無到期日請傳「跳過」`,
      },
    ];
  }

  const expiryDate = parsedDate ?? todayMidnight();
  const todayNotice = !parsedDate
    ? `\n（${current.name} 無到期日，已使用今天日期 ${fmtDate(expiryDate)} 記錄）`
    : '';

  // Save the current pending item
  const { item } = await findOrCreateItem(current.name, current.categoryId, [current.unit]);
  await addStock(item.id, { quantity: current.quantity, unit: current.unit, expiryDate });

  // "完成" — drain remaining with today's date and complete
  if (wantsDone) {
    for (const pending of remaining) {
      const { item: pi } = await findOrCreateItem(pending.name, pending.categoryId, [pending.unit]);
      await addStock(pi.id, {
        quantity: pending.quantity,
        unit: pending.unit,
        expiryDate: todayMidnight(),
      });
    }
    await clearSession(sourceId);
    return [
      { type: 'text', text: `✅ 盤點完成！${todayNotice}\n\n傳「查詢庫存」查看剛才建立的記錄 😊` },
    ];
  }

  // More items waiting for expiry date
  if (remaining.length > 0) {
    const next = remaining[0]!;
    const updatedSession: ConversationState = {
      ...session,
      data: { pendingExpiryQueue: remaining, completionPending },
    };
    await setSession(sourceId, updatedSession);
    return [
      {
        type: 'text',
        text: `${todayNotice ? todayNotice + '\n\n' : ''}❓ 「${next.name}」的到期日是？（格式：YYYY/MM 或 YYYY/MM/DD）\n\n若無到期日請傳「跳過」`,
      },
    ];
  }

  // Queue exhausted — complete or continue
  if (completionPending) {
    await clearSession(sourceId);
    return [
      { type: 'text', text: `✅ 盤點完成！${todayNotice}\n\n傳「查詢庫存」查看剛才建立的記錄 😊` },
    ];
  }

  const updatedSession: ConversationState = {
    ...session,
    step: session.step + 1,
    data: { pendingExpiryQueue: [], completionPending: false },
  };
  await setSession(sourceId, updatedSession);
  return [{ type: 'text', text: `繼續輸入下一項，或傳「完成」結束盤點。${todayNotice}` }];
}

/**
 * Extract a date from free text.
 * Tries YYYY/MM/DD and YYYY/MM patterns; returns null if none found.
 */
function tryParseDate(text: string): Date | null {
  const match = text.match(/(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?/);
  if (!match) return null;

  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10) - 1; // 0-indexed
  const day = match[3] ? parseInt(match[3], 10) : 1;

  const date = new Date(year, month, day);
  if (isNaN(date.getTime()) || year < 2020 || year > 2100) return null;
  return date;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
