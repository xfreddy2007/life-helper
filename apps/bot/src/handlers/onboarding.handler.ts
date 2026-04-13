import {
  listCategories,
  findCategoryByName,
  getDefaultCategory,
  findOrCreateItem,
  addStock,
} from '@life-helper/database/repositories';
import { setSession, clearSession, newSession } from '../services/session.js';
import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';
import type { ConversationState } from '../services/session.js';

/**
 * Step 0 — Initiated by START_ONBOARDING intent.
 * Lists categories and asks user to start entering items.
 */
export async function handleStartOnboarding(sourceId: string): Promise<ReplyMessage[]> {
  const categories = await listCategories();
  const catList = categories.map((c) => `• ${c.name}`).join('\n');

  const state = newSession('ONBOARDING');
  state.step = 1;
  await setSession(sourceId, state);

  return [
    {
      type: 'text',
      text: `📋 開始盤點庫存！\n\n請依序輸入家中現有物品，格式：\n「物品名稱 數量 單位」\n\n例如：\n• 白米 5 kg\n• 橄欖油 2 瓶\n• 廚房紙巾 3 包\n\n可用分類：\n${catList}\n\n輸入「完成」結束盤點。`,
    },
  ];
}

/**
 * Step 1 — User is entering items one by one.
 * Handles NLU RESTOCK or CONFIRM_YES/NO intents during onboarding flow.
 */
export async function handleOnboardingStep(
  nlu: NluResult,
  session: ConversationState,
  sourceId: string,
): Promise<ReplyMessage[]> {
  // User said "完成" or confirms ending
  if (nlu.intent === 'CONFIRM_YES' || nlu.rawText.trim() === '完成') {
    await clearSession(sourceId);
    return [
      {
        type: 'text',
        text: '✅ 盤點完成！\n\n傳「查詢庫存」查看剛才建立的記錄 😊',
      },
    ];
  }

  if (nlu.intent === 'CONFIRM_NO') {
    await clearSession(sourceId);
    return [{ type: 'text', text: '已取消盤點。' }];
  }

  // Expect item entries
  const itemEntities = nlu.entities.items;
  if (!itemEntities || itemEntities.length === 0) {
    return [
      {
        type: 'text',
        text: '請輸入物品格式：「物品名稱 數量 單位」\n例如：「白米 5 kg」\n\n輸入「完成」結束盤點。',
      },
    ];
  }

  const results: string[] = [];

  for (const entity of itemEntities) {
    const { name, quantity, unit } = entity;
    if (!name || quantity == null || !unit) {
      results.push(`⚠️ 格式不正確，請重新輸入`);
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

    const { item, created } = await findOrCreateItem(name, category.id, [unit]);
    await addStock(item.id, { quantity, unit });

    const tag = created ? '（新建立）' : '（已更新）';
    results.push(`✅ ${name} ${quantity}${unit} ${tag}`);
  }

  // Keep the session active for more entries
  const updatedSession: ConversationState = { ...session, step: session.step + 1 };
  await setSession(sourceId, updatedSession);

  return [
    {
      type: 'text',
      text: `${results.join('\n')}\n\n繼續輸入下一項，或傳「完成」結束盤點。`,
    },
  ];
}
