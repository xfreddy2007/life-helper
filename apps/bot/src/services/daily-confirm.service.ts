import { prisma } from '@life-helper/database';
import type { ExpiryBatch } from '@life-helper/database';
import { listItems } from '@life-helper/database/repositories';
import { planFifoDeduction } from './fifo.service.js';
import { getRedis } from '../lib/redis.js';

// ── Redis keys ────────────────────────────────────────────────
const DAILY_KEY = (date: string): string => `daily_confirm:${date}`;
const STREAK_KEY = 'no_reply_streak';
const CONFIRM_TTL_SECS = 60 * 60 * 48; // 48 hours

export type DailyEstimate = {
  itemId: string;
  itemName: string;
  /** Estimated consumption per day (consumptionRate / 7) */
  dailyQty: number;
  unit: string;
  batches: ExpiryBatch[];
};

/**
 * Build estimated daily deductions for items with consumptionRate > 0.
 * Pure function — no DB or Redis writes.
 */
export function buildDailyEstimates(
  items: Array<{
    id: string;
    name: string;
    consumptionRate: number | null;
    units: string[];
    expiryBatches: ExpiryBatch[];
  }>,
): DailyEstimate[] {
  return items
    .filter((item) => (item.consumptionRate ?? 0) > 0)
    .map((item) => ({
      itemId: item.id,
      itemName: item.name,
      dailyQty: (item.consumptionRate ?? 0) / 7,
      unit: item.units[0] ?? '',
      batches: item.expiryBatches,
    }));
}

/**
 * Apply auto-estimated daily deduction to the DB for all tracked items.
 * Each ConsumptionLog is marked `isEstimated = true`.
 * Returns a summary line per item.
 */
export async function applyDailyEstimates(): Promise<string[]> {
  const items = await listItems();
  const estimates = buildDailyEstimates(items);
  const results: string[] = [];

  for (const est of estimates) {
    if (est.dailyQty <= 0) continue;

    const deduction = planFifoDeduction(est.batches, est.dailyQty);
    if (deduction.totalDeducted <= 0) continue;

    await prisma.$transaction(async (tx) => {
      for (const step of deduction.plan) {
        if (step.remainingQty <= 0) {
          await tx.expiryBatch.delete({ where: { id: step.batchId } });
        } else {
          await tx.expiryBatch.update({
            where: { id: step.batchId },
            data: { quantity: step.remainingQty },
          });
        }
      }

      await tx.item.update({
        where: { id: est.itemId },
        data: { totalQuantity: { decrement: deduction.totalDeducted } },
      });

      await tx.consumptionLog.create({
        data: {
          itemId: est.itemId,
          quantity: deduction.totalDeducted,
          unit: est.unit,
          isEstimated: true,
          note: '系統自動推估（每日無回覆）',
        },
      });
    });

    const qty = Math.round(est.dailyQty * 100) / 100;
    results.push(`${est.itemName} -${qty}${est.unit}（推估）`);
  }

  return results;
}

// ── Date helpers ──────────────────────────────────────────────

/**
 * Return today's date as 'YYYY-MM-DD' in Asia/Taipei timezone.
 * Uses Swedish locale (sv-SE) which formats as ISO date string.
 */
export function todayString(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

// ── Redis state helpers ───────────────────────────────────────

/** Record that the daily confirm message was sent for the given date. */
export async function setDailyConfirmSent(date: string): Promise<void> {
  await getRedis().set(DAILY_KEY(date), 'SENT', 'EX', CONFIRM_TTL_SECS);
}

/**
 * Returns true if the daily confirm was sent but NOT yet confirmed by the user.
 * Returns false if confirmed, never sent, or TTL expired.
 */
export async function isDailyConfirmPending(date: string): Promise<boolean> {
  const val = await getRedis().get(DAILY_KEY(date));
  return val === 'SENT';
}

/** Mark today's daily confirm as confirmed (user replied with actual consumption). */
export async function markDailyConfirmConfirmed(date: string): Promise<void> {
  await getRedis().set(DAILY_KEY(date), 'CONFIRMED', 'EX', CONFIRM_TTL_SECS);
}

/** Current count of consecutive days without a daily confirmation reply. */
export async function getNoReplyStreak(): Promise<number> {
  const val = await getRedis().get(STREAK_KEY);
  return val ? parseInt(val, 10) : 0;
}

/** Increment and return the updated streak count. */
export async function incrementNoReplyStreak(): Promise<number> {
  const redis = getRedis();
  const newVal = await redis.incr(STREAK_KEY);
  await redis.expire(STREAK_KEY, 60 * 60 * 24 * 30); // 30-day TTL
  return newVal;
}

/** Reset the no-reply streak (user confirmed today's consumption). */
export async function resetNoReplyStreak(): Promise<void> {
  await getRedis().del(STREAK_KEY);
}
