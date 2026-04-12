import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

export const RecordConsumptionSchema = z.object({
  quantity: z.number().positive(),
  unit: z.string(),
  expiryDate: z.string().datetime().optional(),
  note: z.string().optional(),
});

export const ConsumptionResultSchema = z.object({
  success: z.boolean(),
  remainingQuantity: z.number(),
  anomalyDetected: z.boolean(),
  anomalyMessage: z.string().nullable(),
});

export const consumptionContract = c.router({
  recordConsumption: {
    method: 'POST',
    path: '/inventory/:id/consumption',
    pathParams: z.object({ id: z.string() }),
    body: RecordConsumptionSchema,
    responses: { 200: ConsumptionResultSchema },
  },
});
