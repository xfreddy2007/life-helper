import type { ExpiryBatch } from '@life-helper/database';
import type { PurchaseRecommendation } from '../services/purchase-advisor.service.js';

// ── Inline types used by Phase 6 format helpers ───────────────
type DailyEstimateEntry = { itemName: string; dailyQty: number; unit: string };
type BatchForAlert = {
  quantity: number;
  unit: string;
  expiryDate: Date | null;
  item: { name: string };
};

/** Round to at most 2 decimal places, removing trailing zeros. */
function fmtQty(n: number): string {
  return +n.toFixed(2) + '';
}

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
      return `${fmtQty(b.quantity)}${b.unit}${exp}`;
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
      const batchUnits = new Set(item.expiryBatches.map((b) => b.unit));
      const mixedUnits = batchUnits.size > 1;

      const batches =
        item.expiryBatches.length > 0 ? `（${formatBatches(item.expiryBatches)}）` : '';

      if (mixedUnits) {
        // Total is ambiguous — show batches only
        lines.push(`  ${item.name}：${batches}`.trimEnd());
      } else {
        const unit = item.units[0] ?? '';
        const qty = `${fmtQty(item.totalQuantity)}${unit}`;
        lines.push(`  ${item.name}：${qty} ${batches}`.trimEnd());
      }
    }
  }

  lines.push('─────────────────');
  lines.push(`共 ${items.length} 項`);

  return lines.join('\n');
}

/**
 * Format a purchase recommendation list as a LINE text message.
 */
export function formatPurchaseList(
  recommendations: PurchaseRecommendation[],
  generatedAt = new Date(),
): string {
  if (recommendations.length === 0) {
    return '🎉 目前庫存充足，不需要採購！';
  }

  const dateStr = generatedAt.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Taipei',
  });

  const urgent = recommendations.filter((r) => r.urgency === 'URGENT');
  const suggested = recommendations.filter((r) => r.urgency === 'SUGGESTED');
  const expiry = recommendations.filter((r) => r.urgency === 'EXPIRY');

  const lines: string[] = [`🛒 本週採購清單（${dateStr}）`, '─────────────────'];

  if (urgent.length > 0) {
    lines.push('🔴 急需購買');
    for (const r of urgent) {
      lines.push(`• ${r.itemName} ${r.suggestedQty}${r.unit}（${r.reason}）`);
    }
    lines.push('');
  }

  if (expiry.length > 0) {
    lines.push('⚠️ 即將過期');
    for (const r of expiry) {
      lines.push(`• ${r.itemName}（${r.reason}）`);
    }
    lines.push('');
  }

  if (suggested.length > 0) {
    lines.push('🟡 建議補貨');
    for (const r of suggested) {
      lines.push(`• ${r.itemName} ${r.suggestedQty}${r.unit}（${r.reason}）`);
    }
    lines.push('');
  }

  lines.push('─────────────────');
  lines.push('傳「我這週要買什麼」可隨時查詢');

  return lines.join('\n').trimEnd();
}

/**
 * Build the daily consumption confirmation push message.
 */
export function formatDailyConfirm(estimates: DailyEstimateEntry[]): string {
  const lines = ['📋 今日消耗確認', '─────────────────', '依消耗速率估算今日用量：'];

  for (const e of estimates) {
    const qty = Math.round(e.dailyQty * 100) / 100;
    lines.push(`• ${e.itemName}：約 ${qty}${e.unit}`);
  }

  lines.push('─────────────────');
  lines.push('實際用量不同請直接回覆，例：「今天用了醬油 20ml」');
  lines.push('若沒有回覆，明早 7 點將自動套用預估值。');

  return lines.join('\n');
}

/**
 * Build the expiry alert push message.
 */
export function formatExpiryAlert(approaching: BatchForAlert[], expired: BatchForAlert[]): string {
  const lines: string[] = ['⚠️ 到期提醒', '─────────────────'];

  if (expired.length > 0) {
    lines.push('🚨 已過期（請盡快處理）');
    for (const b of expired) {
      const dateStr = b.expiryDate ? formatDate(b.expiryDate) : '未知日期';
      lines.push(`• ${b.item.name}：${b.quantity}${b.unit}（${dateStr}）`);
    }
    lines.push('');
  }

  if (approaching.length > 0) {
    lines.push('📅 即將到期');
    for (const b of approaching) {
      const dateStr = b.expiryDate ? formatDate(b.expiryDate) : '未知日期';
      lines.push(`• ${b.item.name}：${b.quantity}${b.unit}（${dateStr} 到期）`);
    }
    lines.push('');
  }

  lines.push('─────────────────');
  lines.push('傳「我這週要買什麼」查看採購清單');

  return lines.join('\n').trimEnd();
}
