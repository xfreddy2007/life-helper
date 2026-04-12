import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string(),
  units: z.array(z.string()),
  totalQuantity: z.number(),
  consumptionRate: z.number().nullable(),
  expiryAlertDays: z.number().nullable(),
  safetyStockWeeks: z.number(),
  purchaseSuggestionWeeks: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateItemSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string(),
  units: z.array(z.string()).min(1),
  totalQuantity: z.number().min(0).default(0),
  consumptionRate: z.number().positive().optional(),
  expiryAlertDays: z.number().int().positive().optional(),
});

export const UpdateItemSchema = CreateItemSchema.partial();

export const ErrorSchema = z.object({ message: z.string() });

export const inventoryContract = c.router({
  listItems: {
    method: 'GET',
    path: '/inventory',
    query: z.object({ category: z.string().optional() }),
    responses: { 200: z.array(ItemSchema) },
  },
  getItem: {
    method: 'GET',
    path: '/inventory/:id',
    pathParams: z.object({ id: z.string() }),
    responses: { 200: ItemSchema, 404: ErrorSchema },
  },
  createItem: {
    method: 'POST',
    path: '/inventory',
    body: CreateItemSchema,
    responses: { 201: ItemSchema },
  },
  updateItem: {
    method: 'PATCH',
    path: '/inventory/:id',
    pathParams: z.object({ id: z.string() }),
    body: UpdateItemSchema,
    responses: { 200: ItemSchema, 404: ErrorSchema },
  },
  resetQuantity: {
    method: 'PUT',
    path: '/inventory/:id/quantity',
    pathParams: z.object({ id: z.string() }),
    body: z.object({ quantity: z.number().min(0) }),
    responses: { 200: ItemSchema, 404: ErrorSchema },
  },
});
