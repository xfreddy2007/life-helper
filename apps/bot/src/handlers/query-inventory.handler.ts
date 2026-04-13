import { listItems, findItemByName } from '@life-helper/database/repositories';
import { formatInventoryList, formatBatches } from '../lib/format.js';
import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';

export async function handleQueryInventory(nlu: NluResult): Promise<ReplyMessage[]> {
  const { entities } = nlu;
  const itemName = entities.items?.[0]?.name;
  const categoryName = entities.category;

  // Single item query: "白米還有多少"
  if (itemName) {
    const item = await findItemByName(itemName);
    if (!item) {
      return [
        {
          type: 'text',
          text: `找不到「${itemName}」的庫存記錄。\n\n傳「${itemName} 有 X 個」可以建立新紀錄 😊`,
        },
      ];
    }

    const unit = item.units[0] ?? '';
    const batchInfo =
      item.expiryBatches.length > 0 ? `\n到期批次：${formatBatches(item.expiryBatches)}` : '';

    return [
      {
        type: 'text',
        text: `📦 ${item.name}\n類別：${item.category.name}\n庫存：${item.totalQuantity}${unit}${batchInfo}`,
      },
    ];
  }

  // Category or full list query
  const items = await listItems(categoryName);
  const title = categoryName ? `📦 目前庫存（${categoryName}）` : '📦 目前庫存（全部）';

  return [{ type: 'text', text: formatInventoryList(items, title) }];
}
