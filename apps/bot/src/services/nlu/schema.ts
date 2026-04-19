import { z } from 'zod';

export const IntentSchema = z.enum([
  'QUERY_INVENTORY',
  'RECORD_CONSUMPTION',
  'RESTOCK',
  'QUERY_PURCHASE_LIST',
  'START_ONBOARDING',
  'RESET_ITEM',
  'PARTIAL_RESET',
  'CONFIRM_YES',
  'CONFIRM_NO',
  'SET_CONFIG',
  'REVERT_OPERATION',
  'PURGE_EXPIRED',
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
          unitMismatch: z.boolean().nullish(), // true when unit is semantically wrong for this item
          suggestedUnit: z.string().nullish(), // reasonable unit when unitMismatch is true
        }),
      )
      .nullish(),
    category: z.string().nullish(),
    targetDate: z.string().nullish(),
    config: z
      .object({
        cronKey: z.enum(['DAILY_CONFIRM_PUSH', 'EXPIRY_ALERT', 'WEEKLY_PURCHASE']).nullish(),
        // Time-based schedule
        hour: z.number().int().min(0).max(23).nullish(),
        minute: z.number().int().min(0).max(59).nullish(),
        weekdays: z.array(z.number().int().min(0).max(6)).nullish(), // [0]=Sun, [1,3,5]=Mon/Wed/Fri
        // Interval-based schedule (mutually exclusive with hour/minute)
        intervalSeconds: z.number().int().min(1).nullish(),
        intervalMinutes: z.number().int().min(1).nullish(),
        intervalHours: z.number().int().min(1).nullish(),
      })
      .nullish(),
  }),
  rawText: z.string(),
  confidence: z.number().min(0).max(1),
});

export type NluResult = z.infer<typeof NluResultSchema>;
