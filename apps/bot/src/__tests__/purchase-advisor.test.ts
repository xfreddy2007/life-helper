import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculatePurchaseList, nextSunday } from '../services/purchase-advisor.service.js';
import type { Item, ExpiryBatch } from '@life-helper/database';

// Fix "now" so tests are deterministic regardless of the real day
// Use a Wednesday so nextSunday is 4 days away
const FIXED_NOW = new Date('2026-04-15T10:00:00+08:00'); // Wednesday

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

type ItemWithBatches = Item & { expiryBatches: ExpiryBatch[] };

function makeItem(overrides: Partial<ItemWithBatches> = {}): ItemWithBatches {
  return {
    id: 'item-1',
    name: '白米',
    categoryId: 'cat-1',
    units: ['kg'],
    totalQuantity: 5,
    consumptionRate: 1, // 1 kg/week
    expiryAlertDays: null,
    safetyStockWeeks: 2,
    purchaseSuggestionWeeks: 2,
    expiryBatches: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

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

describe('nextSunday', () => {
  it('returns the coming Sunday from a Wednesday', () => {
    const wed = new Date('2026-04-15T10:00:00'); // Wednesday
    const sun = nextSunday(wed);
    expect(sun.getDay()).toBe(0); // Sunday
    expect(sun.getDate()).toBe(19); // April 19
  });

  it('returns same day when called on a Sunday', () => {
    const sun = new Date('2026-04-19T10:00:00'); // Sunday
    const result = nextSunday(sun);
    expect(result.getDay()).toBe(0);
    expect(result.getDate()).toBe(19);
  });
});

describe('calculatePurchaseList', () => {
  it('returns empty list when all items have sufficient stock', () => {
    const items = [makeItem({ totalQuantity: 100, consumptionRate: 1 })];
    const result = calculatePurchaseList(items, FIXED_NOW);
    expect(result).toHaveLength(0);
  });

  it('marks item as URGENT when stock runs out before next Sunday', () => {
    // Rate = 5 kg/week, qty = 1 → runs out in 0.2 weeks (before next Sunday)
    const items = [makeItem({ totalQuantity: 1, consumptionRate: 5 })];
    const result = calculatePurchaseList(items, FIXED_NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.urgency).toBe('URGENT');
    expect(result[0]!.itemName).toBe('白米');
  });

  it('marks item as SUGGESTED when stock runs out before follow Sunday', () => {
    // Rate = 1 kg/week, qty = 1.5 → survives next Sunday but not the one after
    const items = [makeItem({ totalQuantity: 1.5, consumptionRate: 1 })];
    const result = calculatePurchaseList(items, FIXED_NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.urgency).toBe('SUGGESTED');
  });

  it('marks item as EXPIRY when a batch expires before next Sunday', () => {
    // Plenty of stock but a batch expires this Saturday
    const expiringBatch = makeBatch(1, new Date('2026-04-18')); // Saturday before Sunday
    const items = [
      makeItem({
        totalQuantity: 10,
        consumptionRate: 0.1,
        expiryBatches: [expiringBatch],
      }),
    ];
    const result = calculatePurchaseList(items, FIXED_NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.urgency).toBe('EXPIRY');
  });

  it('deducts expiring batch from effective quantity', () => {
    // 5 total, 4 expires before next Sunday → effective = 1, rate = 5 → URGENT
    const expiringBatch = makeBatch(4, new Date('2026-04-18'));
    const items = [
      makeItem({ totalQuantity: 5, consumptionRate: 5, expiryBatches: [expiringBatch] }),
    ];
    const result = calculatePurchaseList(items, FIXED_NOW);
    expect(result[0]!.urgency).toBe('URGENT');
  });

  it('does not flag items with zero consumption rate as URGENT/SUGGESTED', () => {
    // consumptionRate = 0 → qtyAtNext = totalQuantity, never runs out
    const items = [makeItem({ totalQuantity: 0.1, consumptionRate: 0 })];
    const result = calculatePurchaseList(items, FIXED_NOW);
    // No URGENT/SUGGESTED, might only be EXPIRY if a batch is expiring
    const urgentOrSuggested = result.filter(
      (r) => r.urgency === 'URGENT' || r.urgency === 'SUGGESTED',
    );
    expect(urgentOrSuggested).toHaveLength(0);
  });

  it('sorts results URGENT → EXPIRY → SUGGESTED', () => {
    const urgent = makeItem({
      id: 'u',
      name: 'urgent',
      totalQuantity: 0,
      consumptionRate: 5,
    });
    const expiryBatch = makeBatch(1, new Date('2026-04-18'));
    const expiry = makeItem({
      id: 'e',
      name: 'expiry',
      totalQuantity: 10,
      consumptionRate: 0.1,
      expiryBatches: [expiryBatch],
    });
    const suggested = makeItem({
      id: 's',
      name: 'suggested',
      totalQuantity: 1.5,
      consumptionRate: 1,
    });
    const result = calculatePurchaseList([suggested, expiry, urgent], FIXED_NOW);
    const urgencies = result.map((r) => r.urgency);
    const urgentIdx = urgencies.indexOf('URGENT');
    const expiryIdx = urgencies.indexOf('EXPIRY');
    const suggestedIdx = urgencies.indexOf('SUGGESTED');
    expect(urgentIdx).toBeLessThan(expiryIdx);
    expect(expiryIdx).toBeLessThan(suggestedIdx);
  });

  it('applies purchaseSuggestionWeeks to suggested quantity', () => {
    // rate = 2 kg/week, purchaseSuggestionWeeks = 3 → suggestedQty = ceil(6) = 6
    const items = [makeItem({ totalQuantity: 0, consumptionRate: 2, purchaseSuggestionWeeks: 3 })];
    const result = calculatePurchaseList(items, FIXED_NOW);
    expect(result[0]!.suggestedQty).toBe(6);
  });
});
