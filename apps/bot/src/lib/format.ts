import type { ExpiryBatch } from '@life-helper/database';

/**
 * Format a date as YYYY/MM/DD (Taiwan locale).
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Taipei',
  });
}

/**
 * Format expiry batches into a compact inline string.
 * e.g. "1瓶 2026/08、2瓶 2026/12"
 */
export function formatBatches(batches: ExpiryBatch[]): string {
  if (batches.length === 0) return '無批次資料';

  return batches
    .map((b) => {
      const exp = b.expiryDate ? ` (${formatDate(b.expiryDate)})` : '';
      return `${b.quantity}${b.unit}${exp}`;
    })
    .join('、');
}

/**
 * Build a LINE text message for a list of items with stock levels.
 */
export function formatInventoryList(
  items: Array<{
    name: string;
    totalQuantity: number;
    units: string[];
    expiryBatches: ExpiryBatch[];
    category: { name: string };
  }>,
  title = '📦 目前庫存',
): string {
  if (items.length === 0) {
    return `${title}\n─────────────────\n（尚無庫存資料）\n─────────────────\n傳「開始盤點」建立第一筆物品 🙌`;
  }

  // Group by category
  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const cat = item.category.name;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(item);
  }

  const lines: string[] = [`${title}`, '─────────────────'];

  for (const [cat, catItems] of grouped) {
    lines.push(`【${cat}】`);
    for (const item of catItems) {
      const unit = item.units[0] ?? '';
      const qty = `${item.totalQuantity}${unit}`;
      const batches =
        item.expiryBatches.length > 0 ? `（${formatBatches(item.expiryBatches)}）` : '';
      lines.push(`  ${item.name}：${qty} ${batches}`.trimEnd());
    }
  }

  lines.push('─────────────────');
  lines.push(`共 ${items.length} 項`);

  return lines.join('\n');
}
