import { prisma } from '@life-helper/database';
import type { ExpiryBatch } from '@life-helper/database';
import { findItemByName, getRecentConsumptionLogs } from '@life-helper/database/repositories';
import { planFifoDeduction } from '../services/fifo.service.js';
import {
  detectAnomalousConsumption,
  calculateWeeklyConsumptionRate,
} from '../services/anomaly.service.js';
import { getSession, setSession, clearSession, newSession } from '../services/session.js';
import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';

// ── Anomaly confirmation flow ────────────────────────────────
// Stored in session.data while waiting for user to confirm/reject

interface PendingConsumption {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  expiryDate?: string; // ISO string
}

export async function handleRecordConsumption(
  nlu: NluResult,
  sourceId: string,
): Promise<ReplyMessage[]> {
  const itemEntities = nlu.entities.items;

  if (!itemEntities || itemEntities.length === 0) {
    return [
      {
        type: 'text',
        text: '請告訴我消耗了什麼，例如：\n「今天用了橄欖油半瓶」\n「煮飯用了白米 2 杯」',
      },
    ];
  }

  const results: string[] = [];

  for (const entity of itemEntities) {
    const { name, quantity, unit, expiryDate } = entity;

    if (!name || quantity == null || !unit) {
      results.push(`⚠️ 「${name ?? '?'}」缺少數量或單位，請重新說明`);
      continue;
    }

    const item = await findItemByName(name);
    if (!item) {
      results.push(`找不到「${name}」，請先建立庫存記錄`);
      continue;
    }

    // Anomaly detection
    const recentLogs = await getRecentConsumptionLogs(item.id, 30);
    const anomaly = detectAnomalousConsumption(quantity, recentLogs);

    if (anomaly.isAnomaly) {
      // Pause and ask for confirmation
      const pending: PendingConsumption = {
        itemId: item.id,
        itemName: name,
        quantity,
        unit,
        expiryDate: expiryDate,
      };
      const session = newSession('RESTOCK_CONFIRM');
      session.data = { pendingConsumption: pending };
      await setSession(sourceId, session);

      return [
        {
          type: 'text',
          text: `⚠️ ${anomaly.message}\n\n確認要記錄嗎？\n• 傳「確認」繼續記錄\n• 傳「取消」放棄`,
        },
      ];
    }

    // Normal path — execute immediately
    const line = await executeConsumption(
      item.id,
      name,
      quantity,
      unit,
      item.expiryBatches,
      expiryDate ? new Date(expiryDate) : undefined,
    );
    results.push(line);

    // Update consumption rate
    const allLogs = await getRecentConsumptionLogs(item.id, 30);
    const newRate = calculateWeeklyConsumptionRate(allLogs);
    if (newRate !== null) {
      await prisma.item.update({
        where: { id: item.id },
        data: { consumptionRate: newRate },
      });
    }
  }

  if (results.length === 0) return [{ type: 'text', text: '沒有可以記錄的消耗資訊。' }];

  return [
    {
      type: 'text',
      text: `📝 消耗記錄完成！\n─────────────────\n${results.join('\n')}`,
    },
  ];
}

/**
 * Handles CONFIRM_YES / CONFIRM_NO when a pending anomaly confirmation is stored in session.
 */
export async function handleAnomalyConfirmation(
  isConfirmed: boolean,
  sourceId: string,
): Promise<ReplyMessage[] | null> {
  const session = await getSession(sourceId);
  if (session?.flow !== 'RESTOCK_CONFIRM' || !session.data['pendingConsumption']) {
    return null; // not our flow
  }

  await clearSession(sourceId);

  if (!isConfirmed) {
    return [{ type: 'text', text: '已取消，消耗未記錄。' }];
  }

  const pending = session.data['pendingConsumption'] as PendingConsumption;
  const item = await findItemByName(pending.itemName);

  if (!item) {
    return [{ type: 'text', text: `找不到「${pending.itemName}」，無法記錄消耗。` }];
  }

  const line = await executeConsumption(
    item.id,
    pending.itemName,
    pending.quantity,
    pending.unit,
    item.expiryBatches,
    pending.expiryDate ? new Date(pending.expiryDate) : undefined,
  );

  return [{ type: 'text', text: `📝 已確認記錄\n${line}` }];
}

// ── Internal helpers ──────────────────────────────────────────

async function executeConsumption(
  itemId: string,
  itemName: string,
  quantity: number,
  unit: string,
  batches: ExpiryBatch[],
  preferredExpiry?: Date,
): Promise<string> {
  const deduction = planFifoDeduction(batches, quantity, preferredExpiry);

  // Apply batch deductions and insert log atomically
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
      where: { id: itemId },
      data: { totalQuantity: { decrement: deduction.totalDeducted } },
    });

    await tx.consumptionLog.create({
      data: { itemId, quantity: deduction.totalDeducted, unit },
    });
  });

  if (deduction.shortfall > 0) {
    return `⚠️ ${itemName} -${deduction.totalDeducted}${unit}（庫存不足，差 ${deduction.shortfall}${unit}，已清零）`;
  }
  return `✅ ${itemName} -${quantity}${unit}`;
}
