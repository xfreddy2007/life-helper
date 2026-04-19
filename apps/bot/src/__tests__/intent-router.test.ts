import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeIntent } from '../handlers/intent-router.js';
import type { RouterContext } from '../handlers/intent-router.js';
import type { WebhookEvent } from '@line/bot-sdk';

// Mock database to keep tests unit-level
vi.mock('@life-helper/database', () => ({
  prisma: {
    item: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@life-helper/database/repositories', () => ({
  listItems: vi.fn().mockResolvedValue([]),
  findItemByName: vi.fn().mockResolvedValue(null),
  findOrCreateItem: vi.fn(),
  addStock: vi.fn(),
  resetQuantity: vi.fn(),
  findCategoryByName: vi.fn().mockResolvedValue(null),
  getDefaultCategory: vi.fn().mockResolvedValue({ id: 'cat-1', name: '食材' }),
  getRecentConsumptionLogs: vi.fn().mockResolvedValue([]),
  listCategories: vi
    .fn()
    .mockResolvedValue([{ id: 'cat-1', name: '食材', isDefault: true, defaultExpiryAlertDays: 3 }]),
}));

vi.mock('../services/session.js', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
  newSession: vi
    .fn()
    .mockReturnValue({ flow: 'ONBOARDING', step: 1, data: {}, expiresAt: Date.now() + 99999 }),
}));

import { setSession, clearSession } from '../services/session.js';
const mockSetSession = vi.mocked(setSession);
const mockClearSession = vi.mocked(clearSession);

function makeCtx(overrides: Partial<RouterContext>): RouterContext {
  return {
    event: {} as WebhookEvent,
    nluResult: {
      intent: 'UNKNOWN',
      entities: {},
      rawText: '',
      confidence: 0,
    },
    session: null,
    sourceId: 'group-test',
    ...overrides,
  };
}

describe('routeIntent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('QUERY_INVENTORY with no items returns full list message', async () => {
    const ctx = makeCtx({
      nluResult: { intent: 'QUERY_INVENTORY', entities: {}, rawText: '查庫存', confidence: 0.9 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.type).toBe('text');
    expect(replies[0]?.text).toContain('庫存');
  });

  it('RESTOCK with missing entities returns prompt', async () => {
    const ctx = makeCtx({
      nluResult: { intent: 'RESTOCK', entities: {}, rawText: '補貨', confidence: 0.8 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('補充了什麼物品');
  });

  it('START_ONBOARDING returns category list', async () => {
    const ctx = makeCtx({
      nluResult: {
        intent: 'START_ONBOARDING',
        entities: {},
        rawText: '開始盤點',
        confidence: 0.95,
      },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('盤點');
    expect(replies[0]?.text).toContain('食材');
  });

  it('RESET_ITEM with no entities returns prompt', async () => {
    const ctx = makeCtx({
      nluResult: { intent: 'RESET_ITEM', entities: {}, rawText: '重置', confidence: 0.7 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('重置的物品');
  });

  it('RECORD_CONSUMPTION with no entities returns prompt', async () => {
    const ctx = makeCtx({
      nluResult: { intent: 'RECORD_CONSUMPTION', entities: {}, rawText: '消耗', confidence: 0.9 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('消耗了什麼');
  });

  it('UNKNOWN returns help text', async () => {
    const ctx = makeCtx({
      nluResult: { intent: 'UNKNOWN', entities: {}, rawText: '???', confidence: 0 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('查詢庫存');
  });

  it('CONFIRM_YES with no active session returns no-op message', async () => {
    const ctx = makeCtx({
      nluResult: { intent: 'CONFIRM_YES', entities: {}, rawText: '確認', confidence: 0.99 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('待確認');
  });

  it('delegates to onboarding flow when session is active', async () => {
    const ctx = makeCtx({
      session: { flow: 'ONBOARDING', step: 1, data: {}, expiresAt: Date.now() + 99999 },
      nluResult: { intent: 'CONFIRM_YES', entities: {}, rawText: '完成', confidence: 0.99 },
    });
    const replies = await routeIntent(ctx);
    // Should hit handleOnboardingStep, not the base CONFIRM_YES handler
    expect(replies[0]?.text).toContain('盤點完成');
  });
});

describe('session conflict guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks a session-initiating intent when another session is active', async () => {
    const ctx = makeCtx({
      session: { flow: 'RESTOCK_EXPIRY', step: 1, data: {}, expiresAt: Date.now() + 99999 },
      nluResult: {
        intent: 'START_ONBOARDING',
        entities: {},
        rawText: '開始盤點',
        confidence: 0.95,
      },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('補充庫存');
    expect(replies[0]?.text).toContain('正在進行中');
    expect(replies[0]?.text).toContain('確認');
    expect(mockSetSession).toHaveBeenCalledWith(
      'group-test',
      expect.objectContaining({ flow: 'SESSION_INTERRUPT' }),
    );
  });

  it('allows same-continuation: RESTOCK_EXPIRY + RESTOCK does not trigger conflict', async () => {
    const ctx = makeCtx({
      session: {
        flow: 'RESTOCK_EXPIRY',
        step: 1,
        data: { pendingItems: [] },
        expiresAt: Date.now() + 99999,
      },
      nluResult: {
        intent: 'RESTOCK',
        entities: { items: [{ name: '白米', quantity: 1, unit: 'kg' }] },
        rawText: '買了白米1kg',
        confidence: 0.9,
      },
    });
    const replies = await routeIntent(ctx);
    // Should go through handleRestockExpiryResponse, not conflict guard
    expect(replies[0]?.text).not.toContain('正在進行中');
    expect(mockSetSession).not.toHaveBeenCalledWith(
      'group-test',
      expect.objectContaining({ flow: 'SESSION_INTERRUPT' }),
    );
  });

  it('allows same-continuation: ONBOARDING + START_ONBOARDING returns "in progress"', async () => {
    const ctx = makeCtx({
      session: { flow: 'ONBOARDING', step: 1, data: {}, expiresAt: Date.now() + 99999 },
      nluResult: { intent: 'START_ONBOARDING', entities: {}, rawText: '開始盤點', confidence: 0.9 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('盤點正在進行中');
    expect(mockSetSession).not.toHaveBeenCalledWith(
      'group-test',
      expect.objectContaining({ flow: 'SESSION_INTERRUPT' }),
    );
  });

  it('CONFIRM_YES in SESSION_INTERRUPT clears session and executes pending intent', async () => {
    const pendingNlu = {
      intent: 'START_ONBOARDING',
      entities: {},
      rawText: '開始盤點',
      confidence: 0.95,
    };
    const ctx = makeCtx({
      session: {
        flow: 'SESSION_INTERRUPT',
        step: 0,
        data: {
          previousSession: {
            flow: 'RESTOCK_EXPIRY',
            step: 1,
            data: {},
            expiresAt: Date.now() + 99999,
          },
          pendingNluJson: JSON.stringify(pendingNlu),
        },
        expiresAt: Date.now() + 99999,
      },
      nluResult: { intent: 'CONFIRM_YES', entities: {}, rawText: '確認', confidence: 0.99 },
    });
    const replies = await routeIntent(ctx);
    expect(mockClearSession).toHaveBeenCalledWith('group-test');
    // After clearing, it re-routes the pending START_ONBOARDING
    expect(replies[0]?.text).toContain('盤點');
  });

  it('CONFIRM_NO in SESSION_INTERRUPT restores previous session', async () => {
    const previousSession = {
      flow: 'RESTOCK_EXPIRY',
      step: 1,
      data: {},
      expiresAt: Date.now() + 99999,
    };
    const ctx = makeCtx({
      session: {
        flow: 'SESSION_INTERRUPT',
        step: 0,
        data: {
          previousSession,
          pendingNluJson: JSON.stringify({
            intent: 'START_ONBOARDING',
            entities: {},
            rawText: '開始盤點',
            confidence: 0.9,
          }),
        },
        expiresAt: Date.now() + 99999,
      },
      nluResult: { intent: 'CONFIRM_NO', entities: {}, rawText: '取消', confidence: 0.99 },
    });
    const replies = await routeIntent(ctx);
    expect(mockSetSession).toHaveBeenCalledWith('group-test', previousSession);
    expect(replies[0]?.text).toContain('已繼續');
    expect(replies[0]?.text).toContain('補充庫存');
  });

  it('re-prompts for unknown input in SESSION_INTERRUPT', async () => {
    const ctx = makeCtx({
      session: {
        flow: 'SESSION_INTERRUPT',
        step: 0,
        data: {
          previousSession: {
            flow: 'RESTOCK_EXPIRY',
            step: 1,
            data: {},
            expiresAt: Date.now() + 99999,
          },
          pendingNluJson: JSON.stringify({
            intent: 'START_ONBOARDING',
            entities: {},
            rawText: '開始盤點',
            confidence: 0.9,
          }),
        },
        expiresAt: Date.now() + 99999,
      },
      nluResult: { intent: 'UNKNOWN', entities: {}, rawText: '嗯', confidence: 0 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('請傳「確認」');
  });

  it('QUERY_INVENTORY bypasses the conflict guard (passthrough intent)', async () => {
    const ctx = makeCtx({
      session: { flow: 'RESTOCK_EXPIRY', step: 1, data: {}, expiresAt: Date.now() + 99999 },
      nluResult: { intent: 'QUERY_INVENTORY', entities: {}, rawText: '查庫存', confidence: 0.9 },
    });
    // QUERY_INVENTORY is in SESSION_PASSTHROUGH_INTENTS → goes to handleRestockExpiryResponse
    await routeIntent(ctx);
    expect(mockSetSession).not.toHaveBeenCalledWith(
      'group-test',
      expect.objectContaining({ flow: 'SESSION_INTERRUPT' }),
    );
  });

  it('SET_CONFIG triggers conflict guard when a session is active', async () => {
    const ctx = makeCtx({
      session: { flow: 'REVERT_SELECT', step: 0, data: {}, expiresAt: Date.now() + 99999 },
      nluResult: { intent: 'SET_CONFIG', entities: {}, rawText: '查看排程', confidence: 0.9 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('正在進行中');
    expect(mockSetSession).toHaveBeenCalledWith(
      'group-test',
      expect.objectContaining({ flow: 'SESSION_INTERRUPT' }),
    );
  });

  it('UNKNOWN does not trigger conflict guard (re-prompts within flow)', async () => {
    const ctx = makeCtx({
      session: { flow: 'REVERT_SELECT', step: 0, data: {}, expiresAt: Date.now() + 99999 },
      nluResult: { intent: 'UNKNOWN', entities: {}, rawText: '嗯', confidence: 0 },
    });
    await routeIntent(ctx);
    expect(mockSetSession).not.toHaveBeenCalledWith(
      'group-test',
      expect.objectContaining({ flow: 'SESSION_INTERRUPT' }),
    );
  });
});
