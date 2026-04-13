import type { Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';

const batchWithItemInclude = { item: true } satisfies Prisma.ExpiryBatchInclude;

export type BatchWithItem = Prisma.ExpiryBatchGetPayload<{
  include: typeof batchWithItemInclude;
}>;

/**
 * Batches that expire within `days` from now and haven't been alerted.
 * Excludes already-expired batches (expiryDate >= now).
 */
export async function getApproachingBatches(days: number): Promise<BatchWithItem[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return prisma.expiryBatch.findMany({
    where: {
      alertSent: false,
      expiryDate: { gte: now, lte: cutoff },
    },
    include: batchWithItemInclude,
    orderBy: { expiryDate: 'asc' },
  });
}

/**
 * Batches that have already passed their expiry date and haven't been alerted.
 */
export async function getExpiredBatches(): Promise<BatchWithItem[]> {
  const now = new Date();
  return prisma.expiryBatch.findMany({
    where: {
      alertSent: false,
      expiryDate: { lt: now },
    },
    include: batchWithItemInclude,
    orderBy: { expiryDate: 'asc' },
  });
}

/**
 * Mark a set of batches as alerted so they won't be notified again.
 */
export async function markBatchesAlertSent(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.expiryBatch.updateMany({
    where: { id: { in: ids } },
    data: { alertSent: true },
  });
}
