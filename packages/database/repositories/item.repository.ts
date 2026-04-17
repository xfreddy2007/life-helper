import type { Item, ExpiryBatch, Category, Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';

export type ItemWithBatchesAndCategory = Item & {
  expiryBatches: ExpiryBatch[];
  category: Category;
};

export type CreateItemInput = {
  name: string;
  categoryId: string;
  units: string[];
  expiryAlertDays?: number;
  safetyStockWeeks?: number;
  purchaseSuggestionWeeks?: number;
};

export type AddStockInput = {
  quantity: number;
  unit: string;
  expiryDate?: Date;
};

/**
 * Find one item by exact name (case-insensitive).
 */
export async function findItemByName(name: string): Promise<ItemWithBatchesAndCategory | null> {
  return prisma.item.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    include: { expiryBatches: { orderBy: { expiryDate: 'asc' } }, category: true },
  });
}

/**
 * Find one item by id.
 */
export async function findItemById(id: string): Promise<ItemWithBatchesAndCategory | null> {
  return prisma.item.findUnique({
    where: { id },
    include: { expiryBatches: { orderBy: { expiryDate: 'asc' } }, category: true },
  });
}

/**
 * List all items, optionally filtered by category name.
 */
export async function listItems(categoryName?: string): Promise<ItemWithBatchesAndCategory[]> {
  const where: Prisma.ItemWhereInput = {
    totalQuantity: { gt: 0 },
    ...(categoryName ? { category: { name: { equals: categoryName, mode: 'insensitive' } } } : {}),
  };

  return prisma.item.findMany({
    where,
    include: { expiryBatches: { orderBy: { expiryDate: 'asc' } }, category: true },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  });
}

/**
 * Create a new item (initialises totalQuantity to 0).
 */
export async function createItem(input: CreateItemInput): Promise<ItemWithBatchesAndCategory> {
  return prisma.item.create({
    data: {
      name: input.name,
      categoryId: input.categoryId,
      units: input.units,
      expiryAlertDays: input.expiryAlertDays,
      safetyStockWeeks: input.safetyStockWeeks,
      purchaseSuggestionWeeks: input.purchaseSuggestionWeeks,
    },
    include: { expiryBatches: true, category: true },
  });
}

/**
 * Add a stock batch to an item and update totalQuantity atomically.
 */
export async function addStock(
  itemId: string,
  input: AddStockInput,
): Promise<ItemWithBatchesAndCategory> {
  const [, item] = await prisma.$transaction([
    prisma.expiryBatch.create({
      data: {
        itemId,
        quantity: input.quantity,
        unit: input.unit,
        expiryDate: input.expiryDate,
      },
    }),
    prisma.item.update({
      where: { id: itemId },
      data: { totalQuantity: { increment: input.quantity } },
      include: { expiryBatches: { orderBy: { expiryDate: 'asc' } }, category: true },
    }),
  ]);
  return item;
}

/**
 * Reset an item's total quantity (manual recount).
 * Clears all existing expiry batches and sets a single new batch if quantity > 0.
 */
export async function resetQuantity(
  itemId: string,
  quantity: number,
  unit: string,
): Promise<ItemWithBatchesAndCategory> {
  return prisma.$transaction(async (tx) => {
    await tx.expiryBatch.deleteMany({ where: { itemId } });

    if (quantity > 0) {
      await tx.expiryBatch.create({ data: { itemId, quantity, unit } });
    }

    return tx.item.update({
      where: { id: itemId },
      data: { totalQuantity: quantity },
      include: { expiryBatches: { orderBy: { expiryDate: 'asc' } }, category: true },
    });
  });
}

/**
 * Clear all stock across every item:
 * - Deletes all ExpiryBatch rows
 * - Sets every item's totalQuantity back to 0
 */
export async function resetAllInventory(): Promise<void> {
  await prisma.$transaction([
    prisma.expiryBatch.deleteMany(),
    prisma.item.updateMany({ data: { totalQuantity: 0 } }),
  ]);
}

/**
 * Find or create an item by name. Returns { item, created }.
 */
export async function findOrCreateItem(
  name: string,
  defaultCategoryId: string,
  units: string[],
): Promise<{ item: ItemWithBatchesAndCategory; created: boolean }> {
  const existing = await findItemByName(name);
  if (existing) return { item: existing, created: false };

  const item = await createItem({ name, categoryId: defaultCategoryId, units });
  return { item, created: true };
}
