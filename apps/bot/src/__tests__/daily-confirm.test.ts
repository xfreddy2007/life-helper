import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildDailyEstimates, todayString } from '../services/daily-confirm.service.js';
import { formatDailyConfirm, formatExpiryAlert } from '../lib/format.js';
import type { ExpiryBatch } from '@life-helper/database';

// Fix "now" to a known Wednesday for deterministic date strings
const FIXED_NOW = new Date('2026-04-15T10:00:00+08:00'); // Wednesday

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ────────────────────────────────────────────────────

function makeBatch(quantity: number, expiryDate: Date | null): ExpiryBatch {
  return {
    id: 'b1',
    itemId: 'item-1',
    quantity,
    unit: 'kg',
    expiryDate,
    alertSent: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

type ItemInput = {
  id: string;
  name: string;
  consumptionRate: number | null;
  units: string[];
  expiryBatches: ExpiryBatch[];
};

function makeItem(overrides: Partial<ItemInput> = {}): ItemInput {
  return {
    id: 'item-1',
    name: '白米',
    consumptionRate: 1,
    units: ['kg'],
    expiryBatches: [],
    ...overrides,
  };
}

// ── todayString ───────────────────────────────────────────────

describe('todayString', () => {
  it('returns YYYY-MM-DD format in Taipei timezone', () => {
    // FIXED_NOW is 2026-04-15T10:00:00+08:00 → 2026-04-15 in Taipei
    expect(todayString(FIXED_NOW)).toBe('2026-04-15');
  });

  it('uses current time when called without argument', () => {
    expect(todayString()).toBe('2026-04-15');
  });
});

// ── buildDailyEstimates ───────────────────────────────────────

describe('buildDailyEstimates', () => {
  it('returns empty array when no items have consumptionRate', () => {
    const items = [makeItem({ consumptionRate: 0 }), makeItem({ consumptionRate: null })];
    expect(buildDailyEstimates(items)).toHaveLength(0);
  });

  it('calculates dailyQty as consumptionRate / 7', () => {
    const items = [makeItem({ consumptionRate: 7 })];
    const result = buildDailyEstimates(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.dailyQty).toBeCloseTo(1.0);
  });

  it('uses first unit from the units array', () => {
    const items = [makeItem({ units: ['L', 'ml'], consumptionRate: 7 })];
    const result = buildDailyEstimates(items);
    expect(result[0]!.unit).toBe('L');
  });

  it('falls back to empty string when units array is empty', () => {
    const items = [makeItem({ units: [], consumptionRate: 7 })];
    const result = buildDailyEstimates(items);
    expect(result[0]!.unit).toBe('');
  });

  it('filters out zero-rate items and includes positive-rate items', () => {
    const items = [
      makeItem({ id: 'a', name: '橄欖油', consumptionRate: 2 }),
      makeItem({ id: 'b', name: '鹽', consumptionRate: 0 }),
      makeItem({ id: 'c', name: '醋', consumptionRate: null }),
      makeItem({ id: 'd', name: '白米', consumptionRate: 3.5 }),
    ];
    const result = buildDailyEstimates(items);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.itemName)).toEqual(['橄欖油', '白米']);
  });

  it('includes batches in result', () => {
    const batch = makeBatch(2, new Date('2026-05-01'));
    const items = [makeItem({ expiryBatches: [batch], consumptionRate: 7 })];
    const result = buildDailyEstimates(items);
    expect(result[0]!.batches).toHaveLength(1);
    expect(result[0]!.batches[0]!.id).toBe('b1');
  });
});

// ── formatDailyConfirm ────────────────────────────────────────

describe('formatDailyConfirm', () => {
  it('lists each estimate with rounded quantity', () => {
    const estimates = [
      { itemName: '白米', dailyQty: 1 / 7, unit: 'kg' },
      { itemName: '橄欖油', dailyQty: 0.5 / 7, unit: 'L' },
    ];
    const text = formatDailyConfirm(estimates);
    expect(text).toContain('白米');
    expect(text).toContain('橄欖油');
    expect(text).toContain('今日消耗確認');
    expect(text).toContain('明早 7 點');
  });

  it('handles a single item', () => {
    const estimates = [{ itemName: '醬油', dailyQty: 0.02, unit: 'L' }];
    const text = formatDailyConfirm(estimates);
    expect(text).toContain('醬油');
  });
});

// ── formatExpiryAlert ─────────────────────────────────────────

describe('formatExpiryAlert', () => {
  it('shows all three sections when all present', () => {
    const text = formatExpiryAlert({
      expired: [
        { quantity: 0.5, unit: 'L', expiryDate: new Date('2026-04-10'), item: { name: '牛奶' } },
      ],
      expiresToday: [
        { quantity: 1, unit: '瓶', expiryDate: new Date('2026-04-19'), item: { name: '醬油' } },
      ],
      expiresInWeek: [
        { quantity: 1, unit: 'kg', expiryDate: new Date('2026-04-22'), item: { name: '白米' } },
      ],
    });
    expect(text).toContain('已過期');
    expect(text).toContain('今日到期');
    expect(text).toContain('一週內到期');
    expect(text).toContain('牛奶');
    expect(text).toContain('醬油');
    expect(text).toContain('白米');
  });

  it('shows only expired section when others empty', () => {
    const text = formatExpiryAlert({
      expired: [
        { quantity: 1, unit: 'L', expiryDate: new Date('2026-04-01'), item: { name: '醬油' } },
      ],
      expiresToday: [],
      expiresInWeek: [],
    });
    expect(text).toContain('已過期');
    expect(text).not.toContain('今日到期');
    expect(text).not.toContain('一週內到期');
  });

  it('shows only expiresToday section when others empty', () => {
    const text = formatExpiryAlert({
      expired: [],
      expiresToday: [
        { quantity: 2, unit: '包', expiryDate: new Date('2026-04-19'), item: { name: '鹽' } },
      ],
      expiresInWeek: [],
    });
    expect(text).toContain('今日到期');
    expect(text).not.toContain('已過期');
    expect(text).not.toContain('一週內到期');
  });

  it('shows only expiresInWeek section when others empty', () => {
    const text = formatExpiryAlert({
      expired: [],
      expiresToday: [],
      expiresInWeek: [
        { quantity: 1, unit: 'kg', expiryDate: new Date('2026-04-24'), item: { name: '麵粉' } },
      ],
    });
    expect(text).toContain('一週內到期');
    expect(text).not.toContain('已過期');
    expect(text).not.toContain('今日到期');
  });

  it('renders null expiryDate as 未知日期', () => {
    const text = formatExpiryAlert({
      expired: [],
      expiresToday: [{ quantity: 1, unit: 'kg', expiryDate: null, item: { name: '糖' } }],
      expiresInWeek: [],
    });
    expect(text).toContain('未知日期');
  });

  it('includes purchase list prompt at the bottom', () => {
    const text = formatExpiryAlert({
      expired: [],
      expiresToday: [],
      expiresInWeek: [
        { quantity: 1, unit: 'kg', expiryDate: new Date('2026-04-22'), item: { name: '麵粉' } },
      ],
    });
    expect(text).toContain('採購清單');
  });
});
