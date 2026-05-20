import { describe, it, expect } from 'vitest';
import {
  detectAnomalousConsumption,
  calculateWeeklyConsumptionRate,
} from '../services/anomaly.service.js';
import type { ConsumptionLog } from '@life-helper/database';

function makeLog(quantity: number, daysAgo: number): ConsumptionLog {
  const consumedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id: `log-${daysAgo}`,
    itemId: 'item-1',
    quantity,
    unit: '杯',
    expiryDate: null,
    note: null,
    isEstimated: false,
    consumedAt,
  };
}

describe('detectAnomalousConsumption', () => {
  it('returns no anomaly when history is too sparse (< 5 entries)', () => {
    const logs = [makeLog(2, 7), makeLog(2, 14), makeLog(3, 21)];
    const result = detectAnomalousConsumption(10, logs);
    expect(result.isAnomaly).toBe(false);
    expect(result.zScore).toBeNull();
  });

  it('does not flag normal consumption within 95% CI', () => {
    // Mean ≈ 2, stdDev ≈ 0, z-score for 2.5 is small
    const logs = [2, 2, 2, 2, 2].map((q, i) => makeLog(q, (i + 1) * 7));
    const result = detectAnomalousConsumption(2, logs);
    expect(result.isAnomaly).toBe(false);
  });

  it('flags consumption beyond 95% CI as anomaly', () => {
    // Mean = 2, stdDev ≈ 0.63 → z(10) ≈ 12.7
    const logs = [1, 2, 3, 2, 2].map((q, i) => makeLog(q, (i + 1) * 7));
    const result = detectAnomalousConsumption(10, logs);
    expect(result.isAnomaly).toBe(true);
    expect(result.zScore).toBeGreaterThan(1.96);
    expect(result.message).not.toBeNull();
  });

  it('flags anomaly when all history is identical and input differs', () => {
    const logs = [2, 2, 2, 2, 2].map((q, i) => makeLog(q, (i + 1) * 7));
    const result = detectAnomalousConsumption(10, logs);
    expect(result.isAnomaly).toBe(true);
  });

  it('does not flag anomaly when input matches constant history', () => {
    const logs = [2, 2, 2, 2, 2].map((q, i) => makeLog(q, (i + 1) * 7));
    const result = detectAnomalousConsumption(2, logs);
    expect(result.isAnomaly).toBe(false);
  });

  it('includes mean in anomaly message', () => {
    const logs = [2, 2, 2, 2, 2].map((q, i) => makeLog(q, (i + 1) * 7));
    const result = detectAnomalousConsumption(20, logs);
    expect(result.message).toContain('2.0');
  });
});

describe('calculateWeeklyConsumptionRate', () => {
  it('returns null with fewer than 2 logs', () => {
    expect(calculateWeeklyConsumptionRate([])).toBeNull();
    expect(calculateWeeklyConsumptionRate([makeLog(2, 0)])).toBeNull();
  });

  it('calculates correct weekly rate', () => {
    // 14 cups consumed over 14 days = 7 cups/week
    const logs = [makeLog(7, 14), makeLog(7, 0)];
    const rate = calculateWeeklyConsumptionRate(logs);
    expect(rate).toBeCloseTo(7, 1);
  });

  it('handles multiple logs across several weeks', () => {
    // 4 logs, 2 cups each, spread over 28 days → 4 weeks → 2 cups/week
    const logs = [makeLog(2, 28), makeLog(2, 21), makeLog(2, 14), makeLog(2, 7), makeLog(2, 0)];
    const rate = calculateWeeklyConsumptionRate(logs);
    // 10 cups / 4 weeks = 2.5 cups/week
    expect(rate).toBeGreaterThan(0);
  });

  it('caps rate at total/week when logs are recorded within seconds', () => {
    // Two logs seconds apart — old formula would divide by near-zero span
    // Fix: denominator is clamped to min 1 week, so rate = totalQty / 1 week
    const now = Date.now();
    const log1: ConsumptionLog = {
      id: 'a',
      itemId: 'x',
      quantity: 3,
      unit: '顆',
      expiryDate: null,
      note: null,
      isEstimated: false,
      consumedAt: new Date(now - 30_000),
    };
    const log2: ConsumptionLog = {
      id: 'b',
      itemId: 'x',
      quantity: 7,
      unit: '顆',
      expiryDate: null,
      note: null,
      isEstimated: false,
      consumedAt: new Date(now),
    };
    const rate = calculateWeeklyConsumptionRate([log1, log2]);
    // Without fix: 10 / (30s in weeks) ≈ 20 million. With fix: 10 / 1 = 10
    expect(rate).toBeCloseTo(10, 0);
  });
});
