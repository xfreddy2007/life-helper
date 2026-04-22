import { prisma } from '@life-helper/database';
import type { ExpiryBatch } from '@life-helper/database';
import {
  findItemByName,
  getRecentConsumptionLogs,
  createOperationLog,
} from '@life-helper/database/repositories';
import { planFifoDeduction } from '../services/fifo.service.js';
import { convertUnit } from '../lib/unit-convert.js';
import {
  detectAnomalousConsumption,
  calculateWeeklyConsumptionRate,
} from '../services/anomaly.service.js';
import { getSession, setSession, clearSession, newSession } from '../services/session.js';
import { formatDate } from '../lib/format.js';
import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';

// ── Types ────────────────────────────────────────────────────

interface PendingConsumption {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  expiryDate?: string; // ISO string — present for anomaly confirm, absent for mismatch
}

// A mismatch item queued for sequential confirmation
interface PendingMismatch {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  specifiedDate: string; // formatted, for the confirmation prompt
  batchLines: string; // formatted batch list, for the confirmation prompt
}

// ── Public handlers ──────────────────────────────────────────

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
  let anyConsumed = false;
  const pendingMismatches: PendingMismatch[] = [];

  for (const entity of itemEntities) {
    const { name, quantity, unit, expiryDate } = entity;

    if (!name || quantity == null || !unit) {
      results.push(`⚠️ 「${name ?? '?'}」缺少數量或單位，請重新說明`);
      continue;
    }

    if (entity.unitMismatch) {
      const hint = entity.suggestedUnit ? `（建議使用「${entity.suggestedUnit}」）` : '';
      results.push(`⚠️ 「${name}」使用「${unit}」作為單位不太合理${hint}，請確認後重新輸入`);
      continue;
    }

    if (quantity <= 0) {
      results.push(
        `❓ 「${name}」消耗數量必須大於 0，您輸入了 ${quantity}${unit}，請確認是否正確。`,
      );
      continue;
    }

    const item = await findItemByName(name);
    if (!item) {
      results.push(`找不到「${name}」，請先建立庫存記錄`);
      continue;
    }

    // Check if consumption exceeds available stock (after unit conversion)
    const itemUnit = item.units[0] ?? unit;
    const convertedQty = convertUnit(quantity, unit, itemUnit) ?? quantity;
    if (convertedQty > item.totalQuantity) {
      const available = `${+item.totalQuantity.toFixed(2)}${itemUnit}`;
      const requested = `${quantity}${unit}`;
      results.push(
        `❓ 「${name}」目前庫存只有 ${available}，但您輸入消耗 ${requested}，請確認數量是否正確。`,
      );
      continue;
    }

    // Expiry-batch mismatch: user specified a date that doesn't exist in stock.
    // Don't execute immediately — collect for sequential confirmation after the loop.
    if (expiryDate) {
      const target = new Date(expiryDate);
      target.setHours(0, 0, 0, 0);
      const hasMatch = item.expiryBatches.some((b) => {
        if (!b.expiryDate) return false;
        const d = new Date(b.expiryDate);
        d.setHours(0, 0, 0, 0);
        return d.getTime() === target.getTime();
      });
      if (!hasMatch) {
        const batchLines = item.expiryBatches
          .map(
            (b) =>
              `  ${+b.quantity.toFixed(2)}${b.unit}${b.expiryDate ? `（到期：${formatDate(b.expiryDate)}）` : ''}`,
          )
          .join('\n');
        pendingMismatches.push({
          itemId: item.id,
          itemName: name,
          quantity,
          unit,
          specifiedDate: formatDate(target),
          batchLines,
        });
        continue;
      }
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
        expiryDate: expiryDate ?? undefined,
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
      itemUnit,
      expiryDate ? new Date(expiryDate) : undefined,
      sourceId,
    );
    results.push(line);
    anyConsumed = true;

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

  // Ask confirmation for mismatched items, one at a time.
  // Already-executed results are shown as a prefix, then carried in session.
  if (pendingMismatches.length > 0) {
    const first = pendingMismatches[0]!;
    const queue = pendingMismatches.slice(1);

    const sess = newSession('RESTOCK_CONFIRM');
    sess.data = {
      pendingConsumption: {
        itemId: first.itemId,
        itemName: first.itemName,
        quantity: first.quantity,
        unit: first.unit,
      },
      mismatchQueue: queue,
      completedLines: results,
    };
    await setSession(sourceId, sess);

    const prefix = results.length > 0 ? `${results.join('\n')}\n\n` : '';
    return [
      {
        type: 'text',
        text: `${prefix}⚠️ 「${first.itemName}」沒有到期日為 ${first.specifiedDate} 的庫存批次。\n\n目前批次：\n${first.batchLines}\n\n是否要消耗 ${first.quantity}${first.unit} 的現有庫存（依先進先出順序）？\n• 傳「確認」繼續\n• 傳「取消」放棄`,
      },
    ];
  }

  if (results.length === 0) return [{ type: 'text', text: '沒有可以記錄的消耗資訊。' }];

  const header = anyConsumed ? '📝 消耗記錄完成！\n─────────────────\n' : '';
  return [{ type: 'text', text: `${header}${results.join('\n')}` }];
}

/**
 * Handles CONFIRM_YES / CONFIRM_NO for both anomaly and expiry-mismatch confirmations.
 */
export async function handleAnomalyConfirmation(
  isConfirmed: boolean,
  sourceId: string,
): Promise<ReplyMessage[] | null> {
  const session = await getSession(sourceId);
  if (session?.flow !== 'RESTOCK_CONFIRM' || !session.data['pendingConsumption']) {
    return null; // not our flow
  }

  const pending = session.data['pendingConsumption'] as PendingConsumption;
  const mismatchQueue = (session.data['mismatchQueue'] as PendingMismatch[] | undefined) ?? [];
  const completedLines = (session.data['completedLines'] as string[] | undefined) ?? [];
  const isMismatchFlow = 'mismatchQueue' in session.data;

  await clearSession(sourceId);

  if (!isConfirmed) {
    const cancelMsg = `已取消「${pending.itemName}」的消耗。`;
    // For mismatch flow, also surface any already-executed results
    if (isMismatchFlow && completedLines.length > 0) {
      return [
        {
          type: 'text',
          text: `📝 消耗記錄完成！\n─────────────────\n${completedLines.join('\n')}\n\n${cancelMsg}`,
        },
      ];
    }
    return [{ type: 'text', text: isMismatchFlow ? cancelMsg : '已取消，消耗未記錄。' }];
  }

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
    item.units[0] ?? pending.unit,
    pending.expiryDate ? new Date(pending.expiryDate) : undefined,
    sourceId,
  );

  const allLines = [...completedLines, line];

  // More mismatches waiting — ask about the next one
  if (mismatchQueue.length > 0) {
    const next = mismatchQueue[0]!;
    const remaining = mismatchQueue.slice(1);

    const sess = newSession('RESTOCK_CONFIRM');
    sess.data = {
      pendingConsumption: {
        itemId: next.itemId,
        itemName: next.itemName,
        quantity: next.quantity,
        unit: next.unit,
      },
      mismatchQueue: remaining,
      completedLines: allLines,
    };
    await setSession(sourceId, sess);

    return [
      {
        type: 'text',
        text: `✅ 已記錄「${pending.itemName}」\n\n⚠️ 「${next.itemName}」沒有到期日為 ${next.specifiedDate} 的庫存批次。\n\n目前批次：\n${next.batchLines}\n\n是否要消耗 ${next.quantity}${next.unit} 的現有庫存（依先進先出順序）？\n• 傳「確認」繼續\n• 傳「取消」放棄`,
      },
    ];
  }

  // All done
  if (isMismatchFlow) {
    return [
      {
        type: 'text',
        text: `📝 消耗記錄完成！\n─────────────────\n${allLines.join('\n')}`,
      },
    ];
  }

  // Original anomaly confirm — single item, no queue
  return [{ type: 'text', text: `📝 已確認記錄\n${line}` }];
}

// ── Internal helpers ──────────────────────────────────────────

async function executeConsumption(
  itemId: string,
  itemName: string,
  quantity: number,
  unit: string,
  batches: ExpiryBatch[],
  itemUnit: string,
  preferredExpiry: Date | undefined,
  sourceId: string,
): Promise<string> {
  // Convert consumption quantity to item's storage unit if units differ
  const converted = convertUnit(quantity, unit, itemUnit);
  const deductQty = converted ?? quantity;

  const deduction = planFifoDeduction(batches, deductQty, preferredExpiry);

  // Build a lookup from batchId → batch metadata (needed for logging)
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  // Apply batch deductions and insert log atomically; capture the log id
  let consumptionLogId = '';
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

    const log = await tx.consumptionLog.create({
      data: { itemId, quantity: deduction.totalDeducted, unit: itemUnit },
    });
    consumptionLogId = log.id;
  });

  // Log the operation for potential reversal (non-blocking)
  if (deduction.totalDeducted > 0) {
    await createOperationLog(sourceId, 'CONSUME', `消耗 ${itemName} -${quantity}${unit}`, {
      type: 'CONSUME',
      itemId,
      itemName,
      totalDeducted: deduction.totalDeducted,
      itemUnit,
      consumptionLogId,
      steps: deduction.plan.map((step) => {
        const b = batchMap.get(step.batchId);
        return {
          batchId: step.batchId,
          deducted: step.deductQty,
          unit: b?.unit ?? itemUnit,
          expiryDate: b?.expiryDate?.toISOString() ?? null,
          wasDeleted: step.remainingQty <= 0,
        };
      }),
    });
  }

  if (deduction.shortfall > 0) {
    const shortfallInUserUnit =
      converted !== null
        ? (convertUnit(deduction.shortfall, itemUnit, unit) ?? deduction.shortfall)
        : deduction.shortfall;
    const deductedInUserUnit =
      converted !== null
        ? (convertUnit(deduction.totalDeducted, itemUnit, unit) ?? deduction.totalDeducted)
        : deduction.totalDeducted;
    return `⚠️ ${itemName} -${+deductedInUserUnit.toFixed(2)}${unit}（庫存不足，差 ${+shortfallInUserUnit.toFixed(2)}${unit}，已清零）`;
  }
  return `✅ ${itemName} -${quantity}${unit}`;
}
