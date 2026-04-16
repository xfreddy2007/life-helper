import { z } from 'zod';

export const IntentSchema = z.enum([
  'QUERY_INVENTORY',
  'RECORD_CONSUMPTION',
  'RESTOCK',
  'QUERY_PURCHASE_LIST',
  'START_ONBOARDING',
  'RESET_ITEM',
  'CONFIRM_YES',
  'CONFIRM_NO',
  'SET_CONFIG',
  'UNKNOWN',
]);

export type Intent = z.infer<typeof IntentSchema>;

export const NluResultSchema = z.object({
  intent: IntentSchema,
  entities: z.object({
    items: z
      .array(
        z.object({
          name: z.string(),
          quantity: z.number().nullish(),
          unit: z.string().nullish(),
          expiryDate: z.string().nullish(), // ISO date string
          expiryDays: z.number().nullish(), // e.g. "3天" → 3
        }),
      )
      .nullish(),
    category: z.string().nullish(),
    targetDate: z.string().nullish(),
  }),
  rawText: z.string(),
  confidence: z.number().min(0).max(1),
});

export type NluResult = z.infer<typeof NluResultSchema>;
