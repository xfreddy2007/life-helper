import { Redis } from 'ioredis';
import { logger } from './logger.js';

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    _redis.on('error', (err: Error) => logger.error({ err }, 'Redis connection error'));
    _redis.on('connect', () => logger.info('Redis connected'));
  }
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
