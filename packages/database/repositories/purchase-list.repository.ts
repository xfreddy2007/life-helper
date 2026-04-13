import type { PurchaseList, PurchaseListItem, Item } from '@prisma/client';
import { prisma } from '../db/index.js';

export type PurchaseListWithItems = PurchaseList & {
  items: (PurchaseListItem & { item: Item })[];
};

export type CreatePurchaseListInput = {
  items: {
    itemId: string;
    suggestedQty: number;
    unit: string;
    urgency: 'URGENT' | 'SUGGESTED' | 'EXPIRY';
    reason: string;
  }[];
};

/**
 * Create a new purchase list with its line items in a single transaction.
 */
export async function createPurchaseList(
  input: CreatePurchaseListInput,
): Promise<PurchaseListWithItems> {
  return prisma.purchaseList.create({
    data: {
      items: {
        create: input.items,
      },
    },
    include: { items: { include: { item: true } } },
  });
}

/**
 * Get the most recent PENDING purchase list.
 */
export async function getActivePurchaseList(): Promise<PurchaseListWithItems | null> {
  return prisma.purchaseList.findFirst({
    where: { status: 'PENDING' },
    orderBy: { generatedAt: 'desc' },
    include: { items: { include: { item: true } } },
  });
}

/**
 * Mark a single purchase list item as COMPLETED or SKIPPED.
 */
export async function updatePurchaseListItemStatus(
  itemId: string,
  status: 'COMPLETED' | 'SKIPPED',
): Promise<void> {
  await prisma.purchaseListItem.update({ where: { id: itemId }, data: { status } });
}

/**
 * Mark the whole purchase list as COMPLETED.
 */
export async function completePurchaseList(listId: string): Promise<void> {
  await prisma.$transaction([
    prisma.purchaseListItem.updateMany({
      where: { purchaseListId: listId, status: 'PENDING' },
      data: { status: 'COMPLETED' },
    }),
    prisma.purchaseList.update({
      where: { id: listId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    }),
  ]);
}

/**
 * Find purchase list items matching a set of item IDs in the active list.
 * Used to auto-complete items after a restock event.
 */
export async function findPendingItemsByItemIds(
  itemIds: string[],
): Promise<(PurchaseListItem & { item: Item })[]> {
  return prisma.purchaseListItem.findMany({
    where: {
      status: 'PENDING',
      itemId: { in: itemIds },
      purchaseList: { status: 'PENDING' },
    },
    include: { item: true },
  });
}
