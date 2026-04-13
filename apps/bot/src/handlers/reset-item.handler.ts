import { findItemByName, resetQuantity } from '@life-helper/database/repositories';
import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';

export async function handleResetItem(nlu: NluResult): Promise<ReplyMessage[]> {
  const entity = nlu.entities.items?.[0];

  if (!entity?.name) {
    return [
      {
        type: 'text',
        text: '請指定要重置的物品，例如：\n「白米現在有 5kg」或「醬油重新盤點為 3 瓶」',
      },
    ];
  }

  const { name, quantity, unit } = entity;

  if (quantity == null || !unit) {
    return [
      {
        type: 'text',
        text: `請提供「${name}」的數量和單位，例如：\n「${name} 現在有 2 瓶」`,
      },
    ];
  }

  const item = await findItemByName(name);
  if (!item) {
    return [
      {
        type: 'text',
        text: `找不到「${name}」的記錄。\n傳「${name} 有 ${quantity}${unit}」可以建立新紀錄 😊`,
      },
    ];
  }

  await resetQuantity(item.id, quantity, unit);

  return [
    {
      type: 'text',
      text: `🔄 已重置「${name}」庫存為 ${quantity}${unit}`,
    },
  ];
}
