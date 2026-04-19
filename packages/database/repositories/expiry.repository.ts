import type { Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';

const batchWithItemInclude = { item: true } satisfies Prisma.ExpiryBatchInclude;

export type BatchWithItem = Prisma.ExpiryBatchGetPayload<{
  include: typeof batchWithItemInclude;
}>;

export interface ExpiryAlertBatches {
  /** expiryDate is strictly before the start of today */
  expired: BatchWithItem[];
  /** expiryDate falls within today (start of today ≤ date < start of tomorrow) */
  expiresToday: BatchWithItem[];
  /** expiryDate falls in the range [start of tomorrow, end of today+7] */
  expiresInWeek: BatchWithItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns all batches that have an expiry date, grouped into three categories.
 * No deduplication — every call returns the current state of all batches.
 *
 * Categories (day-level granularity, UTC):
 *   expired      — expiryDate < today
 *   expiresToday — today ≤ expiryDate < tomorrow   (expires at end of today)
 *   expiresInWeek — tomorrow ≤ expiryDate ≤ today+7
 */
export async function getExpiryAlertBatches(): Promise<ExpiryAlertBatches> {
  const todayStart = startOfDay(new Date());
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  // Exclusive upper bound: start of (today + 8 days) covers up to end of today+7
  const weekEndExclusive = new Date(todayStart.getTime() + 8 * DAY_MS);

  const [expired, expiresToday, expiresInWeek] = await Promise.all([
    prisma.expiryBatch.findMany({
      where: { expiryDate: { not: null, lt: todayStart } },
      include: batchWithItemInclude,
      orderBy: { expiryDate: 'asc' },
    }),
    prisma.expiryBatch.findMany({
      where: { expiryDate: { gte: todayStart, lt: tomorrowStart } },
      include: batchWithItemInclude,
      orderBy: { expiryDate: 'asc' },
    }),
    prisma.expiryBatch.findMany({
      where: { expiryDate: { gte: tomorrowStart, lt: weekEndExclusive } },
      include: batchWithItemInclude,
      orderBy: { expiryDate: 'asc' },
    }),
  ]);

  return { expired, expiresToday, expiresInWeek };
}
