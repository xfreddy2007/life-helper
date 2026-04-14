import type { Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';

const mappingWithItem = { item: true } satisfies Prisma.ReceiptMappingInclude;

export type MappingWithItem = Prisma.ReceiptMappingGetPayload<{
  include: typeof mappingWithItem;
}>;

/**
 * Batch-fetch receipt-name → item mappings.
 * Returns only names that have an existing mapping.
 */
export async function findMappingsByReceiptNames(
  receiptNames: string[],
): Promise<MappingWithItem[]> {
  if (receiptNames.length === 0) return [];
  return prisma.receiptMapping.findMany({
    where: { receiptName: { in: receiptNames } },
    include: mappingWithItem,
  });
}

/**
 * Create or update the mapping from a receipt name to an item.
 * Safe to call repeatedly as recognition improves.
 */
export async function upsertReceiptMapping(receiptName: string, itemId: string): Promise<void> {
  await prisma.receiptMapping.upsert({
    where: { receiptName },
    update: { itemId },
    create: { receiptName, itemId },
  });
}
