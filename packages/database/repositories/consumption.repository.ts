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
