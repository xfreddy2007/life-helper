import { describe, it, expect } from 'vitest';
import { formatDate, formatBatches, formatInventoryList } from '../lib/format.js';
import type { ExpiryBatch } from '@life-helper/database';

function makeBatch(overrides: Partial<ExpiryBatch> = {}): ExpiryBatch {
  return {
    id: 'b1',
    itemId: 'i1',
    quantity: 2,
    unit: '瓶',
    expiryDate: null,
    alertSent: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('formatDate', () => {
  it('formats a date in zh-TW locale', () => {
    const date = new Date('2026-08-15T00:00:00+08:00');
    const result = formatDate(date);
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/08/);
    expect(result).toMatch(/15/);
  });
});

describe('formatBatches', () => {
  it('returns placeholder for empty batches', () => {
    expect(formatBatches([])).toBe('無批次資料');
  });

  it('formats batch without expiry date', () => {
    const batch = makeBatch({ quantity: 3, unit: '包', expiryDate: null });
    expect(formatBatches([batch])).toBe('3包');
  });

  it('formats batch with expiry date', () => {
    const batch = makeBatch({ quantity: 1, unit: '瓶', expiryDate: new Date('2026-12-01') });
    const result = formatBatches([batch]);
    expect(result).toContain('1瓶');
    expect(result).toContain('2026');
  });

  it('joins multiple batches with 、', () => {
    const b1 = makeBatch({ id: 'b1', quantity: 1, unit: '瓶' });
    const b2 = makeBatch({ id: 'b2', quantity: 2, unit: '瓶' });
    const result = formatBatches([b1, b2]);
    expect(result).toContain('、');
  });
});

describe('formatInventoryList', () => {
  it('returns empty state message when no items', () => {
    const result = formatInventoryList([], '📦 庫存');
    expect(result).toContain('尚無庫存資料');
    expect(result).toContain('開始盤點');
  });

  it('groups items by category', () => {
    const items = [
      {
        name: '白米',
        totalQuantity: 5,
        units: ['kg'],
        expiryBatches: [],
        category: { name: '食材' },
      },
      {
        name: '醬油',
        totalQuantity: 2,
        units: ['瓶'],
        expiryBatches: [],
        category: { name: '調味料' },
      },
    ];
    const result = formatInventoryList(items);
    expect(result).toContain('【食材】');
    expect(result).toContain('【調味料】');
    expect(result).toContain('白米：5kg');
    expect(result).toContain('醬油：2瓶');
  });

  it('includes batch info when present', () => {
    const batch = makeBatch({ quantity: 2, unit: '瓶', expiryDate: new Date('2026-08-01') });
    const items = [
      {
        name: '橄欖油',
        totalQuantity: 2,
        units: ['瓶'],
        expiryBatches: [batch],
        category: { name: '調味料' },
      },
    ];
    const result = formatInventoryList(items);
    expect(result).toContain('2026');
  });

  it('shows item count in footer', () => {
    const items = [
      {
        name: '鹽',
        totalQuantity: 1,
        units: ['罐'],
        expiryBatches: [],
        category: { name: '調味料' },
      },
    ];
    const result = formatInventoryList(items);
    expect(result).toContain('共 1 項');
  });
});
