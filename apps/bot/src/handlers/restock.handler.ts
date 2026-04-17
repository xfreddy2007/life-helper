import {
  findItemByName,
  addStock,
  findOrCreateItem,
  findCategoryByName,
  getDefaultCategory,
  findPendingItemsByItemIds,
  updatePurchaseListItemStatus,
} from '@life-helper/database/repositories';
import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';

export async function handleRestock(nlu: NluResult): Promise<ReplyMessage[]> {
  const itemEntities = nlu.entities.items;

  if (!itemEntities || itemEntities.length === 0) {
    return [
      {
        type: 'text',
        text: '請告訴我補充了什麼物品，例如：\n「今天買了橄欖油 2 瓶，到期 2026/12」',
      },
    ];
  }

  const results: string[] = [];
  const restockedItemIds: string[] = [];

  for (const entity of itemEntities) {
    const { name, quantity, unit, expiryDate, expiryDays } = entity;

    if (!name) continue;

    if (quantity == null || !unit) {
      results.push(`⚠️ 「${name}」缺少數量或單位，請重新說明`);
      continue;
    }

    if (entity.unitMismatch) {
      const hint = entity.suggestedUnit ? `（建議使用「${entity.suggestedUnit}」）` : '';
      results.push(`⚠️ 「${name}」使用「${unit}」作為單位不太合理${hint}，請確認後重新輸入`);
      continue;
    }

    // Resolve expiry date
    let resolvedExpiry: Date | undefined;
    if (expiryDate) {
      resolvedExpiry = new Date(expiryDate);
    } else if (expiryDays != null) {
      resolvedExpiry = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    }

    // Find or create the item
    let item = await findItemByName(name);

    if (!item) {
      const categoryName = nlu.entities.category;
      const category = categoryName
        ? ((await findCategoryByName(categoryName)) ?? (await getDefaultCategory()))
        : await getDefaultCategory();

      if (!category) {
        results.push(`❌ 找不到適合的分類，無法建立「${name}」`);
        continue;
      }

      const created = await findOrCreateItem(name, category.id, [unit]);
      item = created.item;
    }

    await addStock(item.id, { quantity, unit, expiryDate: resolvedExpiry });
    restockedItemIds.push(item.id);

    const expStr = resolvedExpiry
      ? `（到期：${resolvedExpiry.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })}）`
      : '';
    results.push(`✅ ${name} +${quantity}${unit} ${expStr}`.trimEnd());
  }

  // Auto-complete matching purchase list items
  const completed: string[] = [];
  if (restockedItemIds.length > 0) {
    const pending = await findPendingItemsByItemIds(restockedItemIds);
    for (const li of pending) {
      await updatePurchaseListItemStatus(li.id, 'COMPLETED');
      completed.push(li.item.name);
    }
  }

  const summary = results.length > 0 ? results.join('\n') : '沒有識別到有效的補貨資訊';
  const completedNote =
    completed.length > 0 ? `\n\n✔️ 採購清單已自動標記：${completed.join('、')}` : '';

  return [
    {
      type: 'text',
      text: `🛍️ 補貨完成！\n─────────────────\n${summary}${completedNote}`,
    },
  ];
}
