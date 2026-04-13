import type { ConsumptionLog } from '@life-helper/database';

export type AnomalyDetectionResult = {
  isAnomaly: boolean;
  zScore: number | null;
  mean: number | null;
  message: string | null;
};

/** Minimum history needed before anomaly detection fires. */
const MIN_HISTORY = 5;

/** Z-score threshold corresponding to 95% confidence interval. */
const Z_THRESHOLD = 1.96;

/**
 * Detect whether `inputQty` is anomalously large compared to historical logs.
 * Returns isAnomaly=false (and zScore=null) when history is too sparse.
 */
export function detectAnomalousConsumption(
  inputQty: number,
  historicalLogs: ConsumptionLog[],
): AnomalyDetectionResult {
  const quantities = historicalLogs.map((l) => l.quantity);

  if (quantities.length < MIN_HISTORY) {
    return { isAnomaly: false, zScore: null, mean: null, message: null };
  }

  const mean = average(quantities);
  const stdDev = standardDeviation(quantities);

  // Avoid division-by-zero when all historical values are identical
  if (stdDev === 0) {
    const isAnomaly = inputQty !== mean;
    return {
      isAnomaly,
      zScore: isAnomaly ? Infinity : 0,
      mean,
      message: isAnomaly
        ? `消耗 ${inputQty} 與歷史用量 ${mean.toFixed(1)} 不符，請確認是否正確？`
        : null,
    };
  }

  const zScore = Math.abs((inputQty - mean) / stdDev);
  const isAnomaly = zScore > Z_THRESHOLD;

  return {
    isAnomaly,
    zScore,
    mean,
    message: isAnomaly
      ? `消耗 ${inputQty} 遠超過歷史平均 ${mean.toFixed(1)}（Z=${zScore.toFixed(2)}），請確認是否正確？`
      : null,
  };
}

/**
 * Recalculate the weekly consumption rate from the most recent logs.
 * Returns null if there isn't enough data.
 */
export function calculateWeeklyConsumptionRate(logs: ConsumptionLog[]): number | null {
  if (logs.length < 2) return null;

  // Sort ascending by date
  const sorted = [...logs].sort((a, b) => a.consumedAt.getTime() - b.consumedAt.getTime());

  const oldest = sorted[0]!.consumedAt;
  const newest = sorted[sorted.length - 1]!.consumedAt;
  const spanMs = newest.getTime() - oldest.getTime();

  if (spanMs <= 0) return null;

  const totalQty = sorted.reduce((sum, l) => sum + l.quantity, 0);
  const spanWeeks = spanMs / (7 * 24 * 60 * 60 * 1000);

  return totalQty / spanWeeks;
}

// ── Math helpers ─────────────────────────────────────────────

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const mean = average(values);
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(average(squaredDiffs));
}
