import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleRecordConsumption,
  handleAnomalyConfirmation,
} from '../handlers/record-consumption.handler.js';
import type { NluResult } from '../services/nlu/schema.js';

const mockTx = {
  expiryBatch: { delete: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
  item: { update: vi.fn().mockResolvedValue({}) },
  consumptionLog: { create: vi.fn().mockResolvedValue({}) },
};

vi.mock('@life-helper/database', () => ({
  prisma: {
    item: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi
      .fn()
      .mockImplementation((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
  },
}));

vi.mock('@life-helper/database/repositories', () => ({
  findItemByName: vi.fn(),
  getRecentConsumptionLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/fifo.service.js', () => ({
  planFifoDeduction: vi.fn().mockReturnValue({
    plan: [{ batchId: 'b1', deductQty: 1, remainingQty: 0 }],
    totalDeducted: 1,
    shortfall: 0,
  }),
}));

vi.mock('../services/anomaly.service.js', () => ({
  detectAnomalousConsumption: vi.fn().mockReturnValue({ isAnomaly: false, message: '' }),
  calculateWeeklyConsumptionRate: vi.fn().mockReturnValue(1),
}));

vi.mock('../services/session.js', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
  newSession: vi.fn().mockReturnValue({
    flow: 'RESTOCK_CONFIRM',
    step: 0,
    data: {},
    expiresAt: Date.now() + 99999,
  }),
}));

import { findItemByName } from '@life-helper/database/repositories';
import { detectAnomalousConsumption } from '../services/anomaly.service.js';
import { getSession } from '../services/session.js';

const mockFindItemByName = vi.mocked(findItemByName);
const mockDetectAnomaly = vi.mocked(detectAnomalousConsumption);
const mockGetSession = vi.mocked(getSession);

const mockItem = {
  id: 'item-1',
  name: '白米',
  units: ['kg'],
  totalQuantity: 10,
  consumptionRate: 1,
  expiryAlertDays: null,
  safetyStockWeeks: 2,
  purchaseSuggestionWeeks: 2,
  categoryId: 'cat-1',
  category: {
    id: 'cat-1',
    name: '食材',
    isDefault: true,
    defaultExpiryAlertDays: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  expiryBatches: [
    {
      id: 'b1',
      itemId: 'item-1',
      quantity: 10,
      unit: 'kg',
      expiryDate: null,
      alertSent: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeNlu(overrides: Partial<NluResult> = {}): NluResult {
  return { intent: 'RECORD_CONSUMPTION', entities: {}, rawText: '', confidence: 0.9, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('handleRecordConsumption', () => {
  it('returns prompt when no item entities', async () => {
    const replies = await handleRecordConsumption(makeNlu(), 'group-1');
    expect(replies[0]!.text).toContain('消耗了什麼');
  });

  it('returns error when entity missing name/quantity/unit', async () => {
    const nlu = makeNlu({ entities: { items: [{ name: '白米' }] } });
    const replies = await handleRecordConsumption(nlu, 'group-1');
    expect(replies[0]!.text).toContain('缺少數量或單位');
  });

  it('returns not-found when item does not exist', async () => {
    mockFindItemByName.mockResolvedValue(null);
    const nlu = makeNlu({ entities: { items: [{ name: '豆腐', quantity: 1, unit: '盒' }] } });
    const replies = await handleRecordConsumption(nlu, 'group-1');
    expect(replies[0]!.text).toContain('找不到');
  });

  it('records consumption on normal (non-anomalous) path', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    mockDetectAnomaly.mockReturnValue({
      isAnomaly: false,
      zScore: null,
      mean: null,
      message: null,
    });
    const nlu = makeNlu({ entities: { items: [{ name: '白米', quantity: 1, unit: 'kg' }] } });
    const replies = await handleRecordConsumption(nlu, 'group-1');
    expect(replies[0]!.text).toContain('消耗記錄完成');
    expect(replies[0]!.text).toContain('白米');
  });

  it('pauses for confirmation on anomalous consumption', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    mockDetectAnomaly.mockReturnValue({
      isAnomaly: true,
      zScore: 3,
      mean: 1,
      message: '消耗量異常',
    });
    const nlu = makeNlu({ entities: { items: [{ name: '白米', quantity: 20, unit: 'kg' }] } });
    const replies = await handleRecordConsumption(nlu, 'group-1');
    expect(replies[0]!.text).toContain('確認');
  });

  it('warns when requested quantity exceeds available stock', async () => {
    mockFindItemByName.mockResolvedValue(mockItem as never);
    mockDetectAnomaly.mockReturnValue({
      isAnomaly: false,
      zScore: null,
      mean: null,
      message: null,
    });
    const nlu = makeNlu({ entities: { items: [{ name: '白米', quantity: 15, unit: 'kg' }] } });
    const replies = await handleRecordConsumption(nlu, 'group-1');
    expect(replies[0]!.text).toContain('目前庫存只有');
    expect(replies[0]!.text).toContain('請確認數量');
  });
});

describe('handleAnomalyConfirmation', () => {
  it('returns null when no RESTOCK_CONFIRM session exists', async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await handleAnomalyConfirmation(true, 'group-1');
    expect(result).toBeNull();
  });

  it('returns null when session flow is not RESTOCK_CONFIRM', async () => {
    mockGetSession.mockResolvedValue({ flow: 'ONBOARDING', step: 0, data: {}, expiresAt: 9999 });
    const result = await handleAnomalyConfirmation(true, 'group-1');
    expect(result).toBeNull();
  });

  it('cancels consumption on CONFIRM_NO', async () => {
    mockGetSession.mockResolvedValue({
      flow: 'RESTOCK_CONFIRM',
      step: 0,
      data: { pendingConsumption: { itemId: 'i1', itemName: '白米', quantity: 20, unit: 'kg' } },
      expiresAt: 9999,
    });
    const result = await handleAnomalyConfirmation(false, 'group-1');
    expect(result![0]!.text).toContain('已取消');
  });

  it('executes consumption on CONFIRM_YES', async () => {
    mockGetSession.mockResolvedValue({
      flow: 'RESTOCK_CONFIRM',
      step: 0,
      data: { pendingConsumption: { itemId: 'i1', itemName: '白米', quantity: 20, unit: 'kg' } },
      expiresAt: 9999,
    });
    mockFindItemByName.mockResolvedValue(mockItem as never);
    const result = await handleAnomalyConfirmation(true, 'group-1');
    expect(result![0]!.text).toContain('已確認記錄');
  });
});
