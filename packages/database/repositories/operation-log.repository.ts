import type { OperationLog } from '@prisma/client';
import { prisma } from '../db/index.js';

// ── Reversal data shapes ──────────────────────────────────────

export interface RestockReversal {
  type: 'RESTOCK';
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  expiryDate: string | null; // ISO string
}

export interface ConsumeReversal {
  type: 'CONSUME';
  itemId: string;
  itemName: string;
  totalDeducted: number;
  itemUnit: string;
  consumptionLogId: string;
  steps: Array<{
    batchId: string;
    deducted: number;
    unit: string;
    expiryDate: string | null; // ISO string
    wasDeleted: boolean;
  }>;
}

export type ReversalData = RestockReversal | ConsumeReversal;

// ── Repository functions ──────────────────────────────────────

export async function createOperationLog(
  sourceId: string,
  type: 'RESTOCK' | 'CONSUME',
  description: string,
  reversalData: ReversalData,
): Promise<void> {
  await prisma.operationLog.create({
    data: { sourceId, type, description, reversalData: reversalData as object },
  });
}

export async function getRecentOperationLogs(
  sourceId: string,
  limit = 10,
): Promise<OperationLog[]> {
  return prisma.operationLog.findMany({
    where: { sourceId, reversed: false },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getOperationLogById(id: string): Promise<OperationLog | null> {
  return prisma.operationLog.findUnique({ where: { id } });
}

/**
 * Reverse a single operation and mark it as reversed.
 * Returns a human-readable result message.
 */
export async function reverseOperation(log: OperationLog): Promise<string> {
  const data = log.reversalData as unknown as ReversalData;

  if (data.type === 'RESTOCK') {
    return reverseRestock(log.id, data);
  }
  return reverseConsume(log.id, data);
}

// ── Internal reversal helpers ─────────────────────────────────

async function reverseRestock(logId: string, data: RestockReversal): Promise<string> {
  const { itemId, itemName, quantity, unit, expiryDate } = data;

  const batch = await prisma.expiryBatch.findFirst({
    where: {
      itemId,
      unit,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    },
  });

  if (!batch) {
    return `⚠️ 找不到「${itemName}」的對應批次（可能已全部消耗），無法撤銷`;
  }

  const removeQty = Math.min(batch.quantity, quantity);

  await prisma.$transaction(async (tx) => {
    if (removeQty >= batch.quantity) {
      await tx.expiryBatch.delete({ where: { id: batch.id } });
    } else {
      await tx.expiryBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: removeQty } },
      });
    }
    await tx.item.update({
      where: { id: itemId },
      data: { totalQuantity: { decrement: removeQty } },
    });
    await tx.operationLog.update({ where: { id: logId }, data: { reversed: true } });
  });

  return `✅ 已撤銷補貨：${itemName} -${removeQty}${unit}`;
}

async function reverseConsume(logId: string, data: ConsumeReversal): Promise<string> {
  const { itemId, itemName, totalDeducted, itemUnit, consumptionLogId, steps } = data;

  await prisma.$transaction(async (tx) => {
    for (const step of steps) {
      const existing = await tx.expiryBatch.findUnique({ where: { id: step.batchId } });

      if (existing) {
        await tx.expiryBatch.update({
          where: { id: step.batchId },
          data: { quantity: { increment: step.deducted } },
        });
      } else {
        // Batch was deleted (either by consumption or by another op) — recreate it
        await tx.expiryBatch.create({
          data: {
            itemId,
            quantity: step.deducted,
            unit: step.unit,
            expiryDate: step.expiryDate ? new Date(step.expiryDate) : null,
          },
        });
      }
    }

    await tx.item.update({
      where: { id: itemId },
      data: { totalQuantity: { increment: totalDeducted } },
    });

    // Remove the consumption log entry (best-effort)
    await tx.consumptionLog.deleteMany({ where: { id: consumptionLogId } });

    await tx.operationLog.update({ where: { id: logId }, data: { reversed: true } });
  });

  return `✅ 已撤銷消耗：${itemName} +${totalDeducted}${itemUnit}`;
}
