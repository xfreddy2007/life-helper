import type { Category } from '@prisma/client';
import { prisma } from '../db/index.js';

/**
 * List all categories ordered by name.
 */
export async function listCategories(): Promise<Category[]> {
  return prisma.category.findMany({ orderBy: { name: 'asc' } });
}

/**
 * Find a category by exact name (case-insensitive).
 */
export async function findCategoryByName(name: string): Promise<Category | null> {
  return prisma.category.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
}

/**
 * Find a category by id.
 */
export async function findCategoryById(id: string): Promise<Category | null> {
  return prisma.category.findUnique({ where: { id } });
}

/**
 * Returns the first default category (used as fallback when user doesn't specify one).
 */
export async function getDefaultCategory(): Promise<Category | null> {
  return prisma.category.findFirst({ where: { isDefault: true }, orderBy: { name: 'asc' } });
}
