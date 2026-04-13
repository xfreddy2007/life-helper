import type { ExpiryBatch } from '@life-helper/database';

export type DeductionPlan = {
  batchId: string;
  deductQty: number;
  remainingQty: number; // remaining in this batch after deduction
};

export type FifoDeductionResult = {
  plan: DeductionPlan[];
  totalDeducted: number;
  shortfall: number; // > 0 if stock ran out before consuming requested qty
};

/**
 * Calculate a FIFO deduction plan across expiry batches.
 *
 * Batches must be pre-sorted oldest-expiry-first (nulls last).
 * If `preferredExpiryDate` is given, that batch is tried first; falls back
 * to FIFO if the date doesn't match any batch.
 *
 * This function is pure (no DB side-effects) so it is easy to unit-test.
 */
export function planFifoDeduction(
  batches: ExpiryBatch[],
  quantityToDeduct: number,
  preferredExpiryDate?: Date,
): FifoDeductionResult {
  if (batches.length === 0 || quantityToDeduct <= 0) {
    return { plan: [], totalDeducted: 0, shortfall: quantityToDeduct };
  }

  // Build ordered list: preferred batch first (if specified), then oldest-first
  const ordered = sortBatchesForDeduction(batches, preferredExpiryDate);

  const plan: DeductionPlan[] = [];
  let remaining = quantityToDeduct;

  for (const batch of ordered) {
    if (remaining <= 0) break;

    const deduct = Math.min(batch.quantity, remaining);
    plan.push({
      batchId: batch.id,
      deductQty: deduct,
      remainingQty: batch.quantity - deduct,
    });
    remaining -= deduct;
  }

  return {
    plan,
    totalDeducted: quantityToDeduct - remaining,
    shortfall: Math.max(0, remaining),
  };
}

function sortBatchesForDeduction(
  batches: ExpiryBatch[],
  preferredExpiryDate?: Date,
): ExpiryBatch[] {
  if (!preferredExpiryDate) {
    return fifoOrder(batches);
  }

  const preferredMs = preferredExpiryDate.getTime();
  const preferred = batches.filter(
    (b) => b.expiryDate && Math.abs(b.expiryDate.getTime() - preferredMs) < 24 * 60 * 60 * 1000,
  );

  if (preferred.length === 0) {
    // Fallback: no matching batch found, use FIFO
    return fifoOrder(batches);
  }

  const rest = batches.filter((b) => !preferred.includes(b));
  return [...preferred, ...fifoOrder(rest)];
}

/** Sort batches oldest expiry first; batches without expiry go last. */
function fifoOrder(batches: ExpiryBatch[]): ExpiryBatch[] {
  return [...batches].sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate.getTime() - b.expiryDate.getTime();
  });
}
