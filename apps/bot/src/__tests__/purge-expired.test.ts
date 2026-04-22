import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePurgeExpired, handlePurgeExpiredFlow } from '../handlers/purge-expired.handler.js';
import type { ConversationState } from '../services/session.js';
import type { NluResult } from '../services/nlu/schema.js';

// ── Mock: database (prisma + repositories) ────────────────────

const mockTx = {
  expiryBatch: {
    findUnique: vi.fn(),
    delete: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  },
  item: { update: vi.fn().mockResolvedValue({}) },
};

vi.mock('@life-helper/database', () => ({
  prisma: {
    $transaction: vi
      .fn()
      .mockImplementation((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
  },
}));

vi.mock('@life-helper/database/repositories', () => ({
  getExpiryAlertBatches: vi.fn(),
  createOperationLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/session.js', () => ({
  newSession: vi.fn(() => ({
    flow: 'PURGE_EXPIRED',
    step: 0,
    data: {},
    expiresAt: Date.now() + 99999,
  })),
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

import { getExpiryAlertBatches, createOperationLog } from '@life-helper/database/repositories';
import { setSession, clearSession } from '../services/session.js';

const mockGetExpiryAlertBatches = vi.mocked(getExpiryAlertBatches);
const mockCreateOperationLog = vi.mocked(createOperationLog);
const mockSetSession = vi.mocked(setSession);
const mockClearSession = vi.mocked(clearSession);

const SOURCE_ID = 'group-test';

// ── Fixtures ──────────────────────────────────────────────────

function makeItem(name: string, units: string[] = ['瓶']) {
  return {
    id: `item-${name}`,
    name,
    categoryId: 'cat-1',
    units,
    totalQuantity: 10,
    consumptionRate: null,
    expiryAlertDays: null,
    safetyStockWeeks: 2,
    purchaseSuggestionWeeks: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeBatch(
  id: string,
  itemName: string,
  qty: number,
  unit: string,
  expiryDate: Date | null,
) {
  return {
    id,
    itemId: `item-${itemName}`,
    quantity: qty,
    unit,
    expiryDate,
    alertSent: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    item: makeItem(itemName, [unit]),
  };
}

const expiredBatch = makeBatch('b-exp', '牛奶', 3, '瓶', new Date('2026-03-01'));
const todayBatch = makeBatch('b-today', '橄欖油', 1, '瓶', new Date('2026-04-19'));
const weekBatch = makeBatch('b-week', '白米', 5, 'kg', new Date('2026-04-23'));

function makeEmptyBatches() {
  return { expired: [], expiresToday: [], expiresInWeek: [] };
}

function makeNlu(overrides: Partial<NluResult> = {}): NluResult {
  return {
    intent: 'UNKNOWN',
    entities: {},
    rawText: '',
    confidence: 1,
    ...overrides,
  };
}

function makeSession(step = 0, data: Record<string, unknown> = {}): ConversationState {
  return { flow: 'PURGE_EXPIRED', step, data, expiresAt: Date.now() + 99999 };
}

// The stored PurgeBatchEntry objects built by handlePurgeExpired
const storedBatches = [
  {
    index: 1,
    batchId: 'b-exp',
    itemId: 'item-牛奶',
    itemName: '牛奶',
    itemUnit: '瓶',
    quantity: 3,
    unit: '瓶',
    expiryDate: new Date('2026-03-01').toISOString(),
    category: 'expired',
  },
  {
    index: 2,
    batchId: 'b-today',
    itemId: 'item-橄欖油',
    itemName: '橄欖油',
    itemUnit: '瓶',
    quantity: 1,
    unit: '瓶',
    expiryDate: new Date('2026-04-19').toISOString(),
    category: 'expiresToday',
  },
  {
    index: 3,
    batchId: 'b-week',
    itemId: 'item-白米',
    itemName: '白米',
    itemUnit: 'kg',
    quantity: 5,
    unit: 'kg',
    expiryDate: new Date('2026-04-23').toISOString(),
    category: 'expiresInWeek',
  },
];

// ── Tests: handlePurgeExpired ─────────────────────────────────

describe('handlePurgeExpired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty message when no near-expiry batches', async () => {
    mockGetExpiryAlertBatches.mockResolvedValue(makeEmptyBatches());
    const replies = await handlePurgeExpired(SOURCE_ID);
    expect(replies[0]!.text).toContain('無需清理');
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('shows categorised batch list and starts session', async () => {
    mockGetExpiryAlertBatches.mockResolvedValue({
      expired: [expiredBatch],
      expiresToday: [todayBatch],
      expiresInWeek: [weekBatch],
    });
    const replies = await handlePurgeExpired(SOURCE_ID);
    const text = replies[0]!.text;
    expect(text).toContain('🚨 已過期');
    expect(text).toContain('⚠️ 今日到期');
    expect(text).toContain('📅 一週內到期');
    expect(text).toContain('1. 牛奶');
    expect(text).toContain('2. 橄欖油');
    expect(text).toContain('3. 白米');
    expect(mockSetSession).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.objectContaining({ flow: 'PURGE_EXPIRED', step: 0 }),
    );
  });

  it('assigns sequential indices across all categories', async () => {
    mockGetExpiryAlertBatches.mockResolvedValue({
      expired: [expiredBatch],
      expiresToday: [],
      expiresInWeek: [weekBatch],
    });
    const replies = await handlePurgeExpired(SOURCE_ID);
    const text = replies[0]!.text;
    expect(text).toContain('1. 牛奶');
    expect(text).toContain('2. 白米');
  });
});

// ── Tests: handlePurgeExpiredFlow – step 0 (selection) ───────

describe('handlePurgeExpiredFlow – step 0', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.expiryBatch.findUnique.mockResolvedValue({ id: 'b-exp', quantity: 3, unit: '瓶' });
  });

  it('re-prompts on unrecognisable input', async () => {
    const sess = makeSession(0, { batches: storedBatches });
    const replies = await handlePurgeExpiredFlow(makeNlu({ rawText: '亂說' }), sess, SOURCE_ID);
    expect(replies[0]!.text).toContain('請輸入有效的項目編號');
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('cancels on "取消"', async () => {
    const sess = makeSession(0, { batches: storedBatches });
    const replies = await handlePurgeExpiredFlow(
      makeNlu({ intent: 'CONFIRM_NO', rawText: '取消' }),
      sess,
      SOURCE_ID,
    );
    expect(replies[0]!.text).toContain('已取消');
    expect(mockClearSession).toHaveBeenCalledWith(SOURCE_ID);
  });

  it('selects "全部" and advances to step 1', async () => {
    const sess = makeSession(0, { batches: storedBatches });
    const replies = await handlePurgeExpiredFlow(makeNlu({ rawText: '全部' }), sess, SOURCE_ID);
    expect(replies[0]!.text).toContain('確認清理以下過期批次');
    expect(replies[0]!.text).toContain('⚠️ 此操作不計入消耗記錄');
    expect(mockSetSession).toHaveBeenCalledWith(SOURCE_ID, expect.objectContaining({ step: 1 }));
  });

  it('selects a single batch by index', async () => {
    const sess = makeSession(0, { batches: storedBatches });
    const replies = await handlePurgeExpiredFlow(makeNlu({ rawText: '1' }), sess, SOURCE_ID);
    expect(replies[0]!.text).toContain('牛奶');
    expect(replies[0]!.text).toContain('確認清理');
    expect(mockSetSession).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.objectContaining({
        step: 1,
        data: expect.objectContaining({
          pendingPurge: expect.arrayContaining([
            expect.objectContaining({ batchId: 'b-exp', purgeQty: 3 }),
          ]),
        }),
      }),
    );
  });

  it('selects partial quantity "1 2瓶"', async () => {
    const sess = makeSession(0, { batches: storedBatches });
    await handlePurgeExpiredFlow(makeNlu({ rawText: '1 2瓶' }), sess, SOURCE_ID);
    expect(mockSetSession).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.objectContaining({
        data: expect.objectContaining({
          pendingPurge: expect.arrayContaining([
            expect.objectContaining({ batchId: 'b-exp', purgeQty: 2 }),
          ]),
        }),
      }),
    );
  });

  it('selects multiple batches "1,2"', async () => {
    const sess = makeSession(0, { batches: storedBatches });
    await handlePurgeExpiredFlow(makeNlu({ rawText: '1,2' }), sess, SOURCE_ID);
    const call = mockSetSession.mock.calls[0]![1] as ConversationState;
    const pending = call.data['pendingPurge'] as Array<{ batchId: string }>;
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.batchId)).toEqual(['b-exp', 'b-today']);
  });

  it('rejects out-of-range index', async () => {
    const sess = makeSession(0, { batches: storedBatches });
    const replies = await handlePurgeExpiredFlow(makeNlu({ rawText: '99' }), sess, SOURCE_ID);
    expect(replies[0]!.text).toContain('請輸入有效的項目編號');
  });

  it('rejects quantity exceeding stock', async () => {
    const sess = makeSession(0, { batches: storedBatches });
    const replies = await handlePurgeExpiredFlow(makeNlu({ rawText: '1 99瓶' }), sess, SOURCE_ID);
    expect(replies[0]!.text).toContain('數量超出庫存');
  });
});

// ── Tests: handlePurgeExpiredFlow – step 1 (confirmation) ────

describe('handlePurgeExpiredFlow – step 1', () => {
  const pendingPurge = [
    {
      batchId: 'b-exp',
      itemId: 'item-牛奶',
      itemName: '牛奶',
      itemUnit: '瓶',
      purgeQty: 2,
      unit: '瓶',
      expiryDate: new Date('2026-03-01').toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.expiryBatch.findUnique.mockResolvedValue({ id: 'b-exp', quantity: 3, unit: '瓶' });
  });

  it('cancels on "取消" at step 1', async () => {
    const sess = makeSession(1, { batches: storedBatches, pendingPurge });
    const replies = await handlePurgeExpiredFlow(
      makeNlu({ intent: 'CONFIRM_NO', rawText: '取消' }),
      sess,
      SOURCE_ID,
    );
    expect(replies[0]!.text).toContain('已取消');
    expect(mockClearSession).toHaveBeenCalledWith(SOURCE_ID);
  });

  it('re-prompts on invalid input at step 1', async () => {
    const sess = makeSession(1, { batches: storedBatches, pendingPurge });
    const replies = await handlePurgeExpiredFlow(makeNlu({ rawText: '什麼' }), sess, SOURCE_ID);
    expect(replies[0]!.text).toContain('請傳「確認」');
  });

  it('executes purge on CONFIRM_YES', async () => {
    const sess = makeSession(1, { batches: storedBatches, pendingPurge });
    const replies = await handlePurgeExpiredFlow(
      makeNlu({ intent: 'CONFIRM_YES', rawText: '確認' }),
      sess,
      SOURCE_ID,
    );
    expect(replies[0]!.text).toContain('🧹 清理完成');
    expect(replies[0]!.text).toContain('牛奶 -2瓶');
    expect(mockClearSession).toHaveBeenCalledWith(SOURCE_ID);
    expect(mockCreateOperationLog).toHaveBeenCalledWith(
      SOURCE_ID,
      'PURGE_EXPIRED',
      expect.stringContaining('牛奶'),
      expect.objectContaining({ type: 'PURGE_EXPIRED' }),
    );
  });

  it('does NOT create ConsumptionLog on purge', async () => {
    const sess = makeSession(1, { batches: storedBatches, pendingPurge });
    await handlePurgeExpiredFlow(
      makeNlu({ intent: 'CONFIRM_YES', rawText: '確認' }),
      sess,
      SOURCE_ID,
    );
    // Ensure prisma.consumptionLog.create was never called
    expect(mockTx.expiryBatch.findUnique).toHaveBeenCalledWith({ where: { id: 'b-exp' } });
    // No consumptionLog key on mockTx — would throw if called
  });

  it('deletes batch when fully purged', async () => {
    // purgeQty (2) < batch.quantity (3) → update
    const sess = makeSession(1, { batches: storedBatches, pendingPurge });
    await handlePurgeExpiredFlow(
      makeNlu({ intent: 'CONFIRM_YES', rawText: '確認' }),
      sess,
      SOURCE_ID,
    );
    expect(mockTx.expiryBatch.update).toHaveBeenCalledWith({
      where: { id: 'b-exp' },
      data: { quantity: { decrement: 2 } },
    });
    expect(mockTx.expiryBatch.delete).not.toHaveBeenCalled();
  });

  it('deletes batch when purgeQty equals full stock', async () => {
    // purgeQty = 3 = batch.quantity → delete
    const fullPurge = [{ ...pendingPurge[0]!, purgeQty: 3 }];
    const sess = makeSession(1, { batches: storedBatches, pendingPurge: fullPurge });
    await handlePurgeExpiredFlow(
      makeNlu({ intent: 'CONFIRM_YES', rawText: '確認' }),
      sess,
      SOURCE_ID,
    );
    expect(mockTx.expiryBatch.delete).toHaveBeenCalledWith({ where: { id: 'b-exp' } });
    expect(mockTx.expiryBatch.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b-exp' } }),
    );
  });
});
