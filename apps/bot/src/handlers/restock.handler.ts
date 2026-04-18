import {
  findItemByName,
  addStock,
  findOrCreateItem,
  findCategoryByName,
  getDefaultCategory,
  findPendingItemsByItemIds,
  updatePurchaseListItemStatus,
} from '@life-helper/database/repositories';
import { setSession, clearSession, newSession } from '../services/session.js';
import type { ConversationState } from '../services/session.js';
import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';

// ── Types ──────────────────────────────────────────────────────

interface PendingRestockItem {
  name: string;
  quantity: number;
  unit: string;
  defaultCategoryId: string;
}

// ── Public handlers ────────────────────────────────────────────

export async function handleRestock(nlu: NluResult, sourceId: string): Promise<ReplyMessage[]> {
  const itemEntities = nlu.entities.items;

  if (!itemEntities || itemEntities.length === 0) {
    const session = newSession('RESTOCK_EXPIRY');
    session.data = {
      pendingRestockQueue: [],
      completedLines: [],
      restockedItemIds: [],
      awaitingFirstInput: true,
    };
    await setSession(sourceId, session);
    return [
      {
        type: 'text',
        text: '請告訴我補充了什麼物品，例如：\n「今天買了橄欖油 2 瓶，到期 2026/12」\n\n傳「結束」取消',
      },
    ];
  }

  const completedLines: string[] = [];
  const restockedItemIds: string[] = [];
  const pendingQueue: PendingRestockItem[] = [];

  for (const entity of itemEntities) {
    const { name, quantity, unit, expiryDate, expiryDays } = entity;

    if (!name) continue;

    if (quantity == null || !unit) {
      completedLines.push(`⚠️ 「${name}」缺少數量或單位，請重新說明`);
      continue;
    }

    if (entity.unitMismatch) {
      const hint = entity.suggestedUnit ? `（建議使用「${entity.suggestedUnit}」）` : '';
      completedLines.push(`⚠️ 「${name}」使用「${unit}」作為單位不太合理${hint}，請確認後重新輸入`);
      continue;
    }

    // Resolve expiry date
    let resolvedExpiry: Date | undefined;
    if (expiryDate) {
      resolvedExpiry = new Date(expiryDate);
    } else if (expiryDays != null) {
      resolvedExpiry = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    }

    // Resolve the default category for this item
    const existingItem = await findItemByName(name);
    let defaultCategoryId: string;

    if (existingItem) {
      defaultCategoryId = existingItem.categoryId;
    } else {
      const categoryName = nlu.entities.category;
      const category = categoryName
        ? ((await findCategoryByName(categoryName)) ?? (await getDefaultCategory()))
        : await getDefaultCategory();
      if (!category) {
        completedLines.push(`❌ 找不到適合的分類，無法建立「${name}」`);
        continue;
      }
      defaultCategoryId = category.id;
    }

    // No expiry → queue for clarification
    if (!resolvedExpiry) {
      pendingQueue.push({ name, quantity, unit, defaultCategoryId });
      continue;
    }

    // Expiry provided → save immediately (reuse the already-fetched item if it exists)
    const saveItem = existingItem ?? (await findOrCreateItem(name, defaultCategoryId, [unit])).item;
    await addStock(saveItem.id, { quantity, unit, expiryDate: resolvedExpiry });
    restockedItemIds.push(saveItem.id);

    const expStr = `（到期：${resolvedExpiry.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })}）`;
    completedLines.push(`✅ ${name} +${quantity}${unit} ${expStr}`);
  }

  // Some items need expiry clarification → start RESTOCK_EXPIRY flow
  if (pendingQueue.length > 0) {
    const session = newSession('RESTOCK_EXPIRY');
    session.data = { pendingRestockQueue: pendingQueue, completedLines, restockedItemIds };
    await setSession(sourceId, session);

    const prefix = completedLines.length > 0 ? `${completedLines.join('\n')}\n\n` : '';
    const first = pendingQueue[0]!;
    return [
      {
        type: 'text',
        text: `${prefix}❓ 「${first.name}」的到期日是？（格式：YYYY/MM 或 YYYY/MM/DD）\n\n若無到期日請傳「跳過」`,
      },
    ];
  }

  // All items had expiry → finish immediately
  return finishRestock(completedLines, restockedItemIds);
}

/**
 * Called for each user reply during the RESTOCK_EXPIRY flow.
 */
export async function handleRestockExpiryResponse(
  nlu: NluResult,
  session: ConversationState,
  sourceId: string,
): Promise<ReplyMessage[]> {
  const queue = (session.data.pendingRestockQueue ?? []) as PendingRestockItem[];
  const completedLines = (session.data.completedLines ?? []) as string[];
  const restockedItemIds = (session.data.restockedItemIds ?? []) as string[];
  const awaitingFirstInput = Boolean(session.data.awaitingFirstInput);

  const trimmed = nlu.rawText.trim();
  const isDoneEarly = /完成|結束|取消|停止/.test(trimmed) || nlu.intent === 'CONFIRM_NO';

  // Still waiting for the user to tell us what to restock
  if (awaitingFirstInput) {
    if (isDoneEarly) {
      await clearSession(sourceId);
      return [{ type: 'text', text: '已取消補貨。' }];
    }
    // Treat the new message as a fresh restock request
    await clearSession(sourceId);
    return handleRestock(nlu, sourceId);
  }

  if (queue.length === 0) {
    await clearSession(sourceId);
    return finishRestock(completedLines, restockedItemIds);
  }

  const current = queue[0]!;
  const remaining = queue.slice(1);

  const parsedDate = tryParseDate(trimmed);
  const isSkip = /跳過|沒有|無|不知道/.test(trimmed);
  const isNext = /下一項|下一个|下一步|繼續/.test(trimmed);
  const isDone = /完成|結束|取消|停止/.test(trimmed) || nlu.intent === 'CONFIRM_NO';

  // User wants to stop — discard remaining queue and finish with what's already saved
  if (isDone) {
    await clearSession(sourceId);
    return finishRestock(completedLines, restockedItemIds);
  }

  // Unrecognised input → re-prompt
  if (!parsedDate && !isSkip && !isNext) {
    return [
      {
        type: 'text',
        text: `❓ 「${current.name}」的到期日是？（格式：YYYY/MM 或 YYYY/MM/DD）\n\n若無到期日請傳「跳過」`,
      },
    ];
  }

  // Past-date check
  if (parsedDate && parsedDate < todayMidnight()) {
    return [
      {
        type: 'text',
        text: `❌ 到期日 ${fmtDate(parsedDate)} 已是過去的日期，請重新輸入有效到期日。\n\n若無到期日請傳「跳過」`,
      },
    ];
  }

  const expiryDate = parsedDate ?? todayMidnight();
  const todayNotice = !parsedDate ? `（無到期日，已使用今天日期 ${fmtDate(expiryDate)} 記錄）` : '';

  // Save the current item
  const { item } = await findOrCreateItem(current.name, current.defaultCategoryId, [current.unit]);
  await addStock(item.id, { quantity: current.quantity, unit: current.unit, expiryDate });

  const expStr = parsedDate
    ? `（到期：${expiryDate.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })}）`
    : todayNotice;
  const newCompletedLines = [
    ...completedLines,
    `✅ ${current.name} +${current.quantity}${current.unit} ${expStr}`,
  ];
  const newRestockedItemIds = [...restockedItemIds, item.id];

  // More items waiting
  if (remaining.length > 0) {
    const next = remaining[0]!;
    const updatedSession: ConversationState = {
      ...session,
      data: {
        pendingRestockQueue: remaining,
        completedLines: newCompletedLines,
        restockedItemIds: newRestockedItemIds,
      },
    };
    await setSession(sourceId, updatedSession);
    return [
      {
        type: 'text',
        text: `❓ 「${next.name}」的到期日是？（格式：YYYY/MM 或 YYYY/MM/DD）\n\n若無到期日請傳「跳過」`,
      },
    ];
  }

  // Queue exhausted → finish
  await clearSession(sourceId);
  return finishRestock(newCompletedLines, newRestockedItemIds);
}

// ── Private helpers ────────────────────────────────────────────

async function finishRestock(
  completedLines: string[],
  restockedItemIds: string[],
): Promise<ReplyMessage[]> {
  const completed: string[] = [];
  if (restockedItemIds.length > 0) {
    const pending = await findPendingItemsByItemIds(restockedItemIds);
    for (const li of pending) {
      await updatePurchaseListItemStatus(li.id, 'COMPLETED');
      completed.push(li.item.name);
    }
  }

  const summary =
    completedLines.length > 0 ? completedLines.join('\n') : '沒有識別到有效的補貨資訊';
  const completedNote =
    completed.length > 0 ? `\n\n✔️ 採購清單已自動標記：${completed.join('、')}` : '';

  return [
    {
      type: 'text',
      text: `🛍️ 補貨完成！\n─────────────────\n${summary}${completedNote}`,
    },
  ];
}

function tryParseDate(text: string): Date | null {
  const match = text.match(/(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?/);
  if (!match) return null;
  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10) - 1;
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
