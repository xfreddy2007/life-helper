import type { ConsumptionLog } from '@prisma/client';
import { prisma } from '../db/index.js';

export type RecordConsumptionInput = {
  itemId: string;
  quantity: number;
  unit: string;
  expiryDate?: Date;
  note?: string;
  isEstimated?: boolean;
};

/**
 * Insert a consumption log entry.
 */
export async function createConsumptionLog(input: RecordConsumptionInput): Promise<ConsumptionLog> {
  return prisma.consumptionLog.create({
    data: {
      itemId: input.itemId,
      quantity: input.quantity,
      unit: input.unit,
      expiryDate: input.expiryDate,
      note: input.note,
      isEstimated: input.isEstimated ?? false,
    },
  });
}

/**
 * True if at least one user-recorded (non-estimated) consumption log exists
 * in the half-open interval [start, end).
 * Used by the daily-confirm crons to detect whether a consumption session
 * already happened, so the confirmation prompt/reminder can be skipped.
 */
export async function hasManualConsumptionBetween(start: Date, end: Date): Promise<boolean> {
  const found = await prisma.consumptionLog.findFirst({
    where: {
      isEstimated: false,
      consumedAt: { gte: start, lt: end },
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Fetch recent consumption logs for a single item (newest first).
 * Used for consumption rate calculation and anomaly detection.
 */
export async function getRecentConsumptionLogs(
  itemId: string,
  limit = 30,
): Promise<ConsumptionLog[]> {
  return prisma.consumptionLog.findMany({
    where: { itemId },
    orderBy: { consumedAt: 'desc' },
    take: limit,
  });
}
