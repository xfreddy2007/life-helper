import {
  getRecentOperationLogs,
  getOperationLogById,
  reverseOperation,
} from '@life-helper/database/repositories';
import { getSession, setSession, clearSession, newSession } from '../services/session.js';
import { logger } from '../lib/logger.js';
import type { ReplyMessage } from './intent-router.js';
import { CONFIRM_CANCEL_QUICK_REPLY, CANCEL_ONLY_QUICK_REPLY } from './intent-router.js';

// ── Types stored in session ───────────────────────────────────

interface RevertEntry {
  ids: string[]; // one or more log IDs (batch has multiple)
  description: string; // displayed in the numbered list
}

// ── Helpers ───────────────────────────────────────────────────

function fmtTimestamp(date: Date): string {
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Taipei',
    hour12: false,
  });
}

// Strips the leading "消耗 " prefix from an operation log description.
function itemSummary(description: string): string {
  return description.replace(/^消耗\s+/, '');
}

// ── Public handlers ────────────────────────────────────────────

/**
 * Triggered by REVERT_OPERATION intent.
 * Fetches recent operations, groups same-batchId CONSUME logs into one entry,
 * and shows a numbered list so the user can pick a session to revert.
 */
export async function handleRevertOperation(sourceId: string): Promise<ReplyMessage[]> {
  // Fetch more raw logs than we need so batching still yields ≥10 groups.
  const rawLogs = await getRecentOperationLogs(sourceId, 30);

  if (rawLogs.length === 0) {
    return [{ type: 'text', text: '目前沒有可撤銷的操作記錄。' }];
  }

  // Group consecutive CONSUME logs that share a batchId.
  const entries: RevertEntry[] = [];
  const seenBatchIds = new Set<string>();

  for (const log of rawLogs) {
    const data = log.reversalData as Record<string, unknown>;
    const batchId = typeof data.batchId === 'string' ? data.batchId : undefined;

    if (batchId) {
      if (seenBatchIds.has(batchId)) continue; // already grouped
      seenBatchIds.add(batchId);

      const batchLogs = rawLogs.filter(
        (l) => (l.reversalData as Record<string, unknown>).batchId === batchId,
      );
      // Show in execution order (logs are newest-first, so reverse)
      const ordered = [...batchLogs].reverse();
      const ts = fmtTimestamp(ordered[0]!.createdAt);
      const items = ordered.map((l) => itemSummary(l.description)).join('、');

      entries.push({
        ids: batchLogs.map((l) => l.id),
        description:
          batchLogs.length === 1
            ? `[${ts}] ${log.description}`
            : `[${ts}] 消耗批次（${batchLogs.length} 項）：${items}`,
      });
    } else {
      entries.push({
        ids: [log.id],
        description: `[${fmtTimestamp(log.createdAt)}] ${log.description}`,
      });
    }

    if (entries.length >= 10) break;
  }

  const state = newSession('REVERT_SELECT');
  state.data = { entries, step: 0 };
  await setSession(sourceId, state);

  const lines = entries.map((e, i) => `${i + 1}. ${e.description}`).join('\n');
  return [
    {
      type: 'text',
      text: `📋 最近 ${entries.length} 筆操作記錄：\n\n${lines}\n\n請輸入要撤銷的編號：`,
      quickReply: CANCEL_ONLY_QUICK_REPLY,
    },
  ];
}

/**
 * Called for every message while in REVERT_SELECT flow.
 */
export async function handleRevertSelect(text: string, sourceId: string): Promise<ReplyMessage[]> {
  const session = await getSession(sourceId);
  if (session?.flow !== 'REVERT_SELECT') return [];

  const trimmed = text.trim();
  const innerStep = (session.data.step as number) ?? 0;

  // Cancel at any sub-step
  if (/取消|結束|放棄/.test(trimmed)) {
    await clearSession(sourceId);
    return [{ type: 'text', text: '已取消撤銷操作。' }];
  }

  // ── Step 0: awaiting number selection ────────────────────
  if (innerStep === 0) {
    const entries = (session.data.entries as RevertEntry[]) ?? [];
    const num = parseInt(trimmed, 10);

    if (isNaN(num) || num < 1 || num > entries.length) {
      return [
        {
          type: 'text',
          text: `請輸入 1 到 ${entries.length} 之間的數字：`,
          quickReply: CANCEL_ONLY_QUICK_REPLY,
        },
      ];
    }

    const selected = entries[num - 1]!;
    const updated = {
      ...session,
      data: {
        ...session.data,
        step: 1,
        selectedIds: selected.ids,
        selectedDesc: selected.description,
      },
    };
    await setSession(sourceId, updated);

    return [
      {
        type: 'text',
        text: `確認要撤銷：\n「${selected.description}」`,
        quickReply: CONFIRM_CANCEL_QUICK_REPLY,
      },
    ];
  }

  // ── Step 1: awaiting confirm/cancel ──────────────────────
  const isConfirmed = /^確認|^yes|^ok|^是/.test(trimmed);

  if (!isConfirmed) {
    return [
      {
        type: 'text',
        text: '請選擇「確認」執行撤銷，或「取消」放棄。',
        quickReply: CONFIRM_CANCEL_QUICK_REPLY,
      },
    ];
  }

  const logIds = session.data.selectedIds as string[];
  await clearSession(sourceId);

  const resultLines: string[] = [];
  for (const logId of logIds) {
    const log = await getOperationLogById(logId);
    if (!log || log.reversed) continue;
    try {
      const result = await reverseOperation(log);
      resultLines.push(result);
    } catch (err) {
      logger.warn({ err, logId }, 'reverseOperation failed for one log in batch');
    }
  }

  if (resultLines.length === 0) {
    return [{ type: 'text', text: '此操作已被撤銷或無法找到，無法再次撤銷。' }];
  }

  if (resultLines.length === 1) {
    return [{ type: 'text', text: resultLines[0]! }];
  }

  return [
    {
      type: 'text',
      text: `✅ 批次撤銷完成（${resultLines.length} 項）：\n─────────────────\n${resultLines.join('\n')}`,
    },
  ];
}
