import { prisma } from '@life-helper/database';
import { getExpiryAlertBatches, createOperationLog } from '@life-helper/database/repositories';
import { convertUnit } from '../lib/unit-convert.js';
import { formatDate } from '../lib/format.js';
import { setSession, clearSession, newSession } from '../services/session.js';
import type { NluResult } from '../services/nlu/schema.js';
import type { ConversationState } from '../services/session.js';
import type { ReplyMessage } from './intent-router.js';

// ── Internal types ────────────────────────────────────────────

interface PurgeBatchEntry {
  index: number; // 1-based display number
  batchId: string;
  itemId: string;
  itemName: string;
  itemUnit: string; // item's primary storage unit (for totalQuantity deduction)
  quantity: number; // current batch quantity (in batch unit)
  unit: string; // batch unit
  expiryDate: string | null; // ISO
  category: 'expired' | 'expiresToday' | 'expiresInWeek';
}

interface PurgePlanItem {
  batchId: string;
  itemId: string;
  itemName: string;
  itemUnit: string;
  purgeQty: number; // amount to purge (in batch unit)
  unit: string; // batch unit
  expiryDate: string | null;
}

interface DeductionStep {
  batchId: string;
  deducted: number;
  unit: string;
  expiryDate: string | null;
  wasDeleted: boolean;
}

// ── Public handlers ────────────────────────────────────────────

/**
 * Entry point: triggered by PURGE_EXPIRED intent.
 * Loads all expired / near-expiry batches and starts the PURGE_EXPIRED session.
 */
export async function handlePurgeExpired(sourceId: string): Promise<ReplyMessage[]> {
  const { expired, expiresToday, expiresInWeek } = await getExpiryAlertBatches();

  const allBatches: PurgeBatchEntry[] = [];
  let idx = 1;

  for (const b of expired) allBatches.push(toBatchEntry(b, idx++, 'expired'));
  for (const b of expiresToday) allBatches.push(toBatchEntry(b, idx++, 'expiresToday'));
  for (const b of expiresInWeek) allBatches.push(toBatchEntry(b, idx++, 'expiresInWeek'));

  if (allBatches.length === 0) {
    return [{ type: 'text', text: '🎉 目前沒有過期或即將到期的物品，無需清理！' }];
  }

  const sess = newSession('PURGE_EXPIRED');
  sess.data = { batches: allBatches };
  await setSession(sourceId, sess);

  return [{ type: 'text', text: buildListMessage(allBatches) }];
}

/**
 * Called for every message while in PURGE_EXPIRED flow.
 *
 * Step 0 — user selects which batch(es) and optional quantity.
 * Step 1 — user confirms the purge plan.
 */
export async function handlePurgeExpiredFlow(
  nlu: NluResult,
  session: ConversationState,
  sourceId: string,
): Promise<ReplyMessage[]> {
  const batches = session.data.batches as PurgeBatchEntry[];

  // Cancel at any step
  if (nlu.intent === 'CONFIRM_NO' || /取消|放棄|結束/.test(nlu.rawText.trim())) {
    await clearSession(sourceId);
    return [{ type: 'text', text: '已取消清理過期品。' }];
  }

  // ── Step 0: await batch selection ───────────────────────────
  if (session.step === 0) {
    const plan = parseSelection(nlu.rawText, batches);

    if (!plan || plan.length === 0) {
      return [
        {
          type: 'text',
          text:
            `請輸入有效的項目編號（1 ～ ${batches.length}），或傳「取消」放棄。\n\n` +
            `例如：「1」、「2 1${batches[0]?.unit ?? '瓶'}」、「1,2」、「全部」`,
        },
      ];
    }

    // Guard: quantity must not exceed available stock
    const errors: string[] = [];
    for (const p of plan) {
      const batch = batches.find((b) => b.batchId === p.batchId)!;
      if (p.purgeQty > batch.quantity) {
        errors.push(`「${p.itemName}」最多可清理 ${batch.quantity}${batch.unit}`);
      }
    }
    if (errors.length > 0) {
      return [{ type: 'text', text: `❌ 數量超出庫存：\n${errors.join('\n')}\n\n請重新輸入。` }];
    }

    // Advance to step 1: store plan and ask for confirmation
    const updated: ConversationState = {
      ...session,
      step: 1,
      data: { ...session.data, pendingPurge: plan },
    };
    await setSession(sourceId, updated);

    const lines = plan.map((p) => {
      const dateStr = p.expiryDate ? `（${formatDate(new Date(p.expiryDate))}）` : '';
      return `• ${p.itemName} ${p.purgeQty}${p.unit}${dateStr}`;
    });

    return [
      {
        type: 'text',
        text:
          `確認清理以下過期批次？\n─────────────────\n${lines.join('\n')}\n─────────────────\n` +
          `⚠️ 此操作不計入消耗記錄\n傳「確認」執行，或傳「取消」放棄`,
      },
    ];
  }

  // ── Step 1: await confirmation ───────────────────────────────
  if (nlu.intent === 'CONFIRM_YES' || nlu.rawText.trim() === '確認') {
    return executePurge(session, sourceId);
  }

  return [{ type: 'text', text: '請傳「確認」執行清理，或傳「取消」放棄。' }];
}

// ── Internal helpers ──────────────────────────────────────────

type BatchForEntry = {
  id: string;
  itemId: string;
  quantity: number;
  unit: string;
  expiryDate: Date | null;
  item: { name: string; units: string[] };
};

function toBatchEntry(
  b: BatchForEntry,
  index: number,
  category: PurgeBatchEntry['category'],
): PurgeBatchEntry {
  return {
    index,
    batchId: b.id,
    itemId: b.itemId,
    itemName: b.item.name,
    itemUnit: b.item.units[0] ?? b.unit,
    quantity: b.quantity,
    unit: b.unit,
    expiryDate: b.expiryDate?.toISOString() ?? null,
    category,
  };
}

function buildListMessage(batches: PurgeBatchEntry[]): string {
  const lines: string[] = ['🧹 清理過期品', '─────────────────'];

  const formatBatch = (b: PurgeBatchEntry): string => {
    const dateStr = b.expiryDate ? formatDate(new Date(b.expiryDate)) : '未知日期';
    return `${b.index}. ${b.itemName}：${b.quantity}${b.unit}（${dateStr}）`;
  };

  const expired = batches.filter((b) => b.category === 'expired');
  const today = batches.filter((b) => b.category === 'expiresToday');
  const week = batches.filter((b) => b.category === 'expiresInWeek');

  if (expired.length > 0) {
    lines.push('🚨 已過期');
    for (const b of expired) lines.push(formatBatch(b));
    lines.push('');
  }
  if (today.length > 0) {
    lines.push('⚠️ 今日到期');
    for (const b of today) lines.push(formatBatch(b));
    lines.push('');
  }
  if (week.length > 0) {
    lines.push('📅 一週內到期');
    for (const b of week) lines.push(formatBatch(b));
    lines.push('');
  }

  const exampleUnit = batches[0]?.unit ?? '瓶';

  lines.push('─────────────────');
  lines.push('請輸入要清理的項目編號，例如：');
  lines.push('• 「1」清理第 1 項全部');
  lines.push(`• 「1 2${exampleUnit}」清理第 1 項 2${exampleUnit}`);
  lines.push('• 「1,2」清理第 1、2 項全部');
  lines.push('• 「全部」清理所有項目');
  lines.push('或傳「取消」放棄');

  return lines.join('\n');
}

/**
 * Parse user selection text into a purge plan.
 *
 * Supported formats (comma- or newline-separated):
 *   "全部"           → all batches, full quantity
 *   "1"              → batch 1, full quantity
 *   "2 3瓶"          → batch 2, 3 units
 *   "1,2"            → batches 1 and 2, full quantity
 *   "1 2瓶, 3 1kg"   → batch 1 = 2 units, batch 3 = 1 kg
 *
 * Returns null if the text is unrecognisable.
 */
function parseSelection(text: string, batches: PurgeBatchEntry[]): PurgePlanItem[] | null {
  const trimmed = text.trim();

  if (trimmed === '全部' || trimmed.toLowerCase() === 'all') {
    return batches.map((b) => ({
      batchId: b.batchId,
      itemId: b.itemId,
      itemName: b.itemName,
      itemUnit: b.itemUnit,
      purgeQty: b.quantity,
      unit: b.unit,
      expiryDate: b.expiryDate,
    }));
  }

  const segments = trimmed
    .split(/[,，\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const result: PurgePlanItem[] = [];
  const seenBatchIds = new Set<string>();

  for (const seg of segments) {
    // Match: <index> [<qty>[unit]]  e.g. "1", "2 3瓶", "3 1.5kg"
    const match = seg.match(/^(\d+)(?:\s+(.+))?$/);
    if (!match) return null;

    const batchIndex = parseInt(match[1]!, 10);
    const batch = batches.find((b) => b.index === batchIndex);
    if (!batch) return null;
    if (seenBatchIds.has(batch.batchId)) continue; // deduplicate
    seenBatchIds.add(batch.batchId);

    let purgeQty = batch.quantity; // default: full quantity
    if (match[2]) {
      const qtyMatch = match[2].trim().match(/^(\d+(?:\.\d+)?)/);
      if (qtyMatch) {
        const parsed = parseFloat(qtyMatch[1]!);
        if (parsed <= 0) return null;
        purgeQty = parsed;
      }
    }

    result.push({
      batchId: batch.batchId,
      itemId: batch.itemId,
      itemName: batch.itemName,
      itemUnit: batch.itemUnit,
      purgeQty,
      unit: batch.unit,
      expiryDate: batch.expiryDate,
    });
  }

  return result.length > 0 ? result : null;
}

async function executePurge(session: ConversationState, sourceId: string): Promise<ReplyMessage[]> {
  const plan = session.data.pendingPurge as PurgePlanItem[];
  await clearSession(sourceId);

  if (!plan || plan.length === 0) {
    return [{ type: 'text', text: '沒有待清理的項目。' }];
  }

  const resultLines: string[] = [];

  // Track per-item totals for totalQuantity update and OperationLog
  const itemDeductions = new Map<
    string,
    { name: string; unit: string; totalDeducted: number; steps: DeductionStep[] }
  >();

  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      const batch = await tx.expiryBatch.findUnique({ where: { id: p.batchId } });
      if (!batch) continue; // already removed — skip silently

      const actualPurge = Math.min(p.purgeQty, batch.quantity);
      const wasDeleted = actualPurge >= batch.quantity;

      if (wasDeleted) {
        await tx.expiryBatch.delete({ where: { id: p.batchId } });
      } else {
        await tx.expiryBatch.update({
          where: { id: p.batchId },
          data: { quantity: { decrement: actualPurge } },
        });
      }

      // Convert batch unit → item's primary unit for totalQuantity deduction
      const deductedInItemUnit = convertUnit(actualPurge, p.unit, p.itemUnit) ?? actualPurge;

      const existing = itemDeductions.get(p.itemId);
      const step: DeductionStep = {
        batchId: p.batchId,
        deducted: actualPurge,
        unit: p.unit,
        expiryDate: p.expiryDate,
        wasDeleted,
      };

      if (existing) {
        existing.totalDeducted += deductedInItemUnit;
        existing.steps.push(step);
      } else {
        itemDeductions.set(p.itemId, {
          name: p.itemName,
          unit: p.itemUnit,
          totalDeducted: deductedInItemUnit,
          steps: [step],
        });
      }

      resultLines.push(`• ${p.itemName} -${actualPurge}${p.unit}`);
    }

    // Apply totalQuantity decrements per item
    for (const [itemId, d] of itemDeductions) {
      await tx.item.update({
        where: { id: itemId },
        data: { totalQuantity: { decrement: d.totalDeducted } },
      });
    }
  });

  if (resultLines.length === 0) {
    return [{ type: 'text', text: '沒有成功清理任何項目（批次可能已被移除）。' }];
  }

  // Log for potential reversal (does NOT create ConsumptionLog — intentional)
  const logItems = Array.from(itemDeductions.entries()).map(([itemId, d]) => ({
    itemId,
    itemName: d.name,
    purgedQty: d.totalDeducted,
    unit: d.unit,
    steps: d.steps,
  }));

  await createOperationLog(
    sourceId,
    'PURGE_EXPIRED',
    `清理過期品：${logItems.map((i) => i.itemName).join('、')}`,
    { type: 'PURGE_EXPIRED', items: logItems },
  );

  return [
    {
      type: 'text',
      text:
        `🧹 清理完成！\n─────────────────\n${resultLines.join('\n')}\n─────────────────\n` +
        `共清理 ${resultLines.length} 筆批次`,
    },
  ];
}
