import {
  listItems,
  createPurchaseList,
  getActivePurchaseList,
} from '@life-helper/database/repositories';
import { calculatePurchaseList } from '../services/purchase-advisor.service.js';
import { formatPurchaseList } from '../lib/format.js';
import type { ReplyMessage } from './intent-router.js';

/**
 * User asked "我這週要買什麼" — generate or return the active purchase list.
 */
export async function handleQueryPurchaseList(): Promise<ReplyMessage[]> {
  // Return the existing active list if it's from today
  const existing = await getActivePurchaseList();
  if (existing) {
    const generatedToday = existing.generatedAt.toDateString() === new Date().toDateString();
    if (generatedToday) {
      const recs = existing.items.map((li) => ({
        itemId: li.itemId,
        itemName: li.item.name,
        unit: li.unit,
        suggestedQty: li.suggestedQty,
        urgency: li.urgency as 'URGENT' | 'SUGGESTED' | 'EXPIRY',
        reason: li.reason,
      }));
      return [{ type: 'text', text: formatPurchaseList(recs, existing.generatedAt) }];
    }
  }

  // Generate a fresh list
  const items = await listItems();
  const recommendations = calculatePurchaseList(items);

  if (recommendations.length > 0) {
    await createPurchaseList({
      items: recommendations.map((r) => ({
        itemId: r.itemId,
        suggestedQty: r.suggestedQty,
        unit: r.unit,
        urgency: r.urgency,
        reason: r.reason,
      })),
    });
  }

  return [{ type: 'text', text: formatPurchaseList(recommendations) }];
}
