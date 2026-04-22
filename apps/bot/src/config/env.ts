import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { config as dotEnvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const botRoot = resolve(__dirname, '../../');

// In production, Fly.io injects secrets directly — dotenv is a no-op.
// In development/test, load from the environment-specific file.
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.local';
dotEnvConfig({ path: resolve(botRoot, envFile) });

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
