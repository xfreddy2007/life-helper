import { describe, it, expect } from 'vitest';
import { planFifoDeduction } from '../services/fifo.service.js';
import type { ExpiryBatch } from '@life-helper/database';

function makeBatch(id: string, quantity: number, expiryDate: Date | null = null): ExpiryBatch {
  return {
    id,
    itemId: 'item-1',
    quantity,
    unit: '瓶',
    expiryDate,
    alertSent: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

describe('planFifoDeduction', () => {
  it('returns empty plan for empty batches', () => {
    const result = planFifoDeduction([], 2);
    expect(result.plan).toHaveLength(0);
    expect(result.shortfall).toBe(2);
    expect(result.totalDeducted).toBe(0);
  });

  it('returns shortfall equal to quantity when no batches', () => {
    const result = planFifoDeduction([], 5);
    expect(result.shortfall).toBe(5);
  });

  it('deducts from single batch exactly', () => {
    const batches = [makeBatch('b1', 3)];
    const result = planFifoDeduction(batches, 3);
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]!.deductQty).toBe(3);
    expect(result.plan[0]!.remainingQty).toBe(0);
    expect(result.shortfall).toBe(0);
    expect(result.totalDeducted).toBe(3);
  });

  it('deducts partial amount from one batch', () => {
    const batches = [makeBatch('b1', 5)];
    const result = planFifoDeduction(batches, 2);
    expect(result.plan[0]!.deductQty).toBe(2);
    expect(result.plan[0]!.remainingQty).toBe(3);
    expect(result.shortfall).toBe(0);
  });

  it('deducts oldest-expiry batch first (FIFO)', () => {
    const early = makeBatch('early', 2, new Date('2026-06-01'));
    const late = makeBatch('late', 3, new Date('2026-12-01'));
    const result = planFifoDeduction([late, early], 2); // late is passed first
    expect(result.plan[0]!.batchId).toBe('early');
  });

  it('spans multiple batches when first is insufficient', () => {
    const b1 = makeBatch('b1', 1, new Date('2026-06-01'));
    const b2 = makeBatch('b2', 3, new Date('2026-12-01'));
    const result = planFifoDeduction([b1, b2], 3);
    expect(result.plan).toHaveLength(2);
    expect(result.plan[0]!.batchId).toBe('b1');
    expect(result.plan[0]!.deductQty).toBe(1);
    expect(result.plan[1]!.batchId).toBe('b2');
    expect(result.plan[1]!.deductQty).toBe(2);
    expect(result.shortfall).toBe(0);
  });

  it('reports shortfall when stock runs out', () => {
    const b1 = makeBatch('b1', 1);
    const result = planFifoDeduction([b1], 5);
    expect(result.totalDeducted).toBe(1);
    expect(result.shortfall).toBe(4);
  });

  it('batches without expiry date come last', () => {
    const withExpiry = makeBatch('exp', 2, new Date('2026-06-01'));
    const noExpiry = makeBatch('noexp', 5, null);
    const result = planFifoDeduction([noExpiry, withExpiry], 2);
    expect(result.plan[0]!.batchId).toBe('exp');
  });

  it('preferred expiry date batch is deducted first', () => {
    const dec = makeBatch('dec', 3, new Date('2026-12-01'));
    const jun = makeBatch('jun', 3, new Date('2026-06-01'));
    // Prefer December batch (unusual, but user-requested)
    const result = planFifoDeduction([jun, dec], 2, new Date('2026-12-01'));
    expect(result.plan[0]!.batchId).toBe('dec');
  });

  it('falls back to FIFO when preferred date has no matching batch', () => {
    const jun = makeBatch('jun', 3, new Date('2026-06-01'));
    const dec = makeBatch('dec', 3, new Date('2026-12-01'));
    // Preferred date doesn't match either batch — should fall back to FIFO (Jun first)
    const result = planFifoDeduction([dec, jun], 2, new Date('2027-01-01'));
    expect(result.plan[0]!.batchId).toBe('jun');
  });
});
