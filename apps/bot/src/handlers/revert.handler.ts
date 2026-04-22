import {
  getRecentOperationLogs,
  getOperationLogById,
  reverseOperation,
} from '@life-helper/database/repositories';
import { getSession, setSession, clearSession, newSession } from '../services/session.js';
import type { ReplyMessage } from './intent-router.js';

// ── Types stored in session ───────────────────────────────────

interface LogEntry {
  id: string;
  description: string;
}

// ── Public handlers ────────────────────────────────────────────

/**
 * Triggered by REVERT_OPERATION intent.
 * Fetches up to 10 recent reversible operations and shows them as a numbered list.
 */
export async function handleRevertOperation(sourceId: string): Promise<ReplyMessage[]> {
  const logs = await getRecentOperationLogs(sourceId, 10);

  if (logs.length === 0) {
    return [{ type: 'text', text: '目前沒有可撤銷的操作記錄。' }];
  }

  const entries: LogEntry[] = logs.map((l) => ({ id: l.id, description: l.description }));

  const state = newSession('REVERT_SELECT');
  state.data = { entries, step: 0 };
  await setSession(sourceId, state);

  const lines = entries.map((e, i) => `${i + 1}. ${e.description}`).join('\n');
  return [
    {
      type: 'text',
      text: `📋 最近 ${entries.length} 筆操作記錄：\n\n${lines}\n\n請輸入要撤銷的編號，或傳「取消」放棄。`,
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
    const entries = (session.data.entries as LogEntry[]) ?? [];
    const num = parseInt(trimmed, 10);

    if (isNaN(num) || num < 1 || num > entries.length) {
      return [
        {
          type: 'text',
          text: `請輸入 1 到 ${entries.length} 之間的數字，或傳「取消」放棄。`,
        },
      ];
    }

    const selected = entries[num - 1]!;
    const updated = {
      ...session,
      data: {
        ...session.data,
        step: 1,
        selectedId: selected.id,
        selectedDesc: selected.description,
      },
    };
    await setSession(sourceId, updated);

    return [
      {
        type: 'text',
        text: `確認要撤銷：\n「${selected.description}」\n\n• 傳「確認」執行撤銷\n• 傳「取消」放棄`,
      },
    ];
  }

  // ── Step 1: awaiting confirm/cancel ──────────────────────
  const isConfirmed =
    trimmed === '確認' || trimmed === 'yes' || trimmed === 'ok' || trimmed === '是';

  if (!isConfirmed) {
    return [{ type: 'text', text: '請傳「確認」執行撤銷，或傳「取消」放棄。' }];
  }

  const logId = session.data.selectedId as string;
  const log = await getOperationLogById(logId);

  await clearSession(sourceId);

  if (!log || log.reversed) {
    return [{ type: 'text', text: '此操作已被撤銷或無法找到，無法再次撤銷。' }];
  }

  const result = await reverseOperation(log);
  return [{ type: 'text', text: result }];
}
