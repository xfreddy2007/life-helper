import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeIntent } from '../handlers/intent-router.js';
import type { RouterContext } from '../handlers/intent-router.js';
import type { WebhookEvent } from '@line/bot-sdk';

// Mock all repository calls so this test stays unit-level
vi.mock('@life-helper/database/repositories', () => ({
  listItems: vi.fn().mockResolvedValue([]),
  findItemByName: vi.fn().mockResolvedValue(null),
  findOrCreateItem: vi.fn(),
  addStock: vi.fn(),
  resetQuantity: vi.fn(),
  findCategoryByName: vi.fn().mockResolvedValue(null),
  getDefaultCategory: vi.fn().mockResolvedValue({ id: 'cat-1', name: '食材' }),
  listCategories: vi
    .fn()
    .mockResolvedValue([{ id: 'cat-1', name: '食材', isDefault: true, defaultExpiryAlertDays: 3 }]),
}));

vi.mock('../services/session.js', () => ({
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
  newSession: vi
    .fn()
    .mockReturnValue({ flow: 'ONBOARDING', step: 1, data: {}, expiresAt: Date.now() + 99999 }),
}));

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

  it('RECORD_CONSUMPTION returns phase 4 placeholder', async () => {
    const ctx = makeCtx({
      nluResult: { intent: 'RECORD_CONSUMPTION', entities: {}, rawText: '消耗', confidence: 0.9 },
    });
    const replies = await routeIntent(ctx);
    expect(replies[0]?.text).toContain('Phase 4');
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
