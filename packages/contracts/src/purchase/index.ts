import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

export const PurchaseItemSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  itemName: z.string(),
  suggestedQty: z.number(),
  unit: z.string(),
  urgency: z.enum(['URGENT', 'SUGGESTED', 'EXPIRY']),
  reason: z.string(),
  status: z.enum(['PENDING', 'COMPLETED', 'SKIPPED']),
});

export const PurchaseListSchema = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'COMPLETED']),
  generatedAt: z.string(),
  items: z.array(PurchaseItemSchema),
});

export const purchaseContract = c.router({
  getCurrentList: {
    method: 'GET',
    path: '/purchase/current',
    responses: { 200: PurchaseListSchema.nullable() },
  },
  generateList: {
    method: 'POST',
    path: '/purchase/generate',
    body: z.object({}),
    responses: { 201: PurchaseListSchema },
  },
});
