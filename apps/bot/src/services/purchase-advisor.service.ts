import type { Item, ExpiryBatch } from '@life-helper/database';

export type PurchaseUrgency = 'URGENT' | 'SUGGESTED' | 'EXPIRY';

export type PurchaseRecommendation = {
  itemId: string;
  itemName: string;
  unit: string;
  suggestedQty: number;
  urgency: PurchaseUrgency;
  reason: string;
};

type ItemWithBatches = Item & { expiryBatches: ExpiryBatch[] };

/**
 * Calculate which items need to be purchased before the next shopping trip.
 *
 * Shopping model: two reference dates
 *   nextDate  — nearest upcoming Sunday (or today if Sunday)
 *   followDate — the Sunday after that
 *
 * An item is recommended when:
 *   URGENT    — quantity will reach zero before nextDate
 *   SUGGESTED — quantity will reach zero before followDate
 *   EXPIRY    — has a batch expiring before nextDate (even if qty is OK)
 */
export function calculatePurchaseList(
  items: ItemWithBatches[],
  now = new Date(),
): PurchaseRecommendation[] {
  const nextDate = nextSunday(now);
  const followDate = nextSunday(addDays(nextDate, 1));

  const recommendations: PurchaseRecommendation[] = [];

  for (const item of items) {
    const unit = item.units[0] ?? '';
    const weeklyRate = item.consumptionRate ?? 0;

    // Effective stock = total minus batches that expire before nextDate
    const effectiveQty = effectiveQuantity(item, nextDate);

    const weeksToNext = weeksUntil(nextDate, now);
    const weeksToFollow = weeksUntil(followDate, now);

    const qtyAtNext = effectiveQty - weeklyRate * weeksToNext;
    const qtyAtFollow = effectiveQty - weeklyRate * weeksToFollow;

    if (qtyAtNext <= 0 && weeklyRate > 0) {
      const suggestedQty = Math.ceil(weeklyRate * item.purchaseSuggestionWeeks);
      recommendations.push({
        itemId: item.id,
        itemName: item.name,
        unit,
        suggestedQty,
        urgency: 'URGENT',
        reason: `庫存不足，預計 ${formatDate(nextDate)} 前用完`,
      });
      continue;
    }

    if (qtyAtFollow <= 0 && weeklyRate > 0) {
      const suggestedQty = Math.ceil(weeklyRate * item.purchaseSuggestionWeeks);
      recommendations.push({
        itemId: item.id,
        itemName: item.name,
        unit,
        suggestedQty,
        urgency: 'SUGGESTED',
        reason: `預計 ${formatDate(followDate)} 前用完`,
      });
      continue;
    }

    // Check expiry
    const expiringBatch = item.expiryBatches.find((b) => b.expiryDate && b.expiryDate <= nextDate);
    if (expiringBatch?.expiryDate) {
      recommendations.push({
        itemId: item.id,
        itemName: item.name,
        unit,
        suggestedQty: Math.max(1, Math.ceil(weeklyRate * item.purchaseSuggestionWeeks)),
        urgency: 'EXPIRY',
        reason: `${formatDate(expiringBatch.expiryDate)} 即將到期`,
      });
    }
  }

  // Sort: URGENT → EXPIRY → SUGGESTED
  const urgencyOrder: Record<PurchaseUrgency, number> = { URGENT: 0, EXPIRY: 1, SUGGESTED: 2 };
  return recommendations.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Effective quantity = total minus batches that expire before the reference date.
 */
function effectiveQuantity(item: ItemWithBatches, beforeDate: Date): number {
  const expiringQty = item.expiryBatches
    .filter((b) => b.expiryDate && b.expiryDate <= beforeDate)
    .reduce((sum, b) => sum + b.quantity, 0);
  return Math.max(0, item.totalQuantity - expiringQty);
}

/** Weeks from now until targetDate (minimum 0). */
function weeksUntil(targetDate: Date, now: Date): number {
  const ms = targetDate.getTime() - now.getTime();
  return Math.max(0, ms / (7 * 24 * 60 * 60 * 1000));
}

/** Next Sunday at 00:00 local time; returns today if today is Sunday. */
export function nextSunday(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay(); // 0 = Sunday
  if (dayOfWeek !== 0) {
    d.setDate(d.getDate() + (7 - dayOfWeek));
  }
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Taipei',
  });
}
