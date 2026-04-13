import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    // LINE Bot
    LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
    LINE_CHANNEL_SECRET: z.string().min(1),
    LINE_GROUP_ID: z.string().min(1),

    // Anthropic Claude API
    ANTHROPIC_API_KEY: z.string().startsWith('sk-'),

    // Database
    DATABASE_URL: z.string().url(),

    // Redis
    REDIS_URL: z.string().min(1),

    // Sentry (optional)
    SENTRY_DSN: z.string().url().optional(),

    // Server
    PORT: z
      .string()
      .default('3000')
      .transform((v) => parseInt(v, 10)),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  },
  runtimeEnv: process.env,
});
