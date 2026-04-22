import { getRedis } from '../lib/redis.js';

const USERS_KEY = 'bot:registered_users';

/** Persist a LINE userId so cron jobs can push to individual chats. */
export async function registerUser(userId: string): Promise<void> {
  await getRedis().sadd(USERS_KEY, userId);
}

/** Returns all registered user IDs. */
export async function getRegisteredUsers(): Promise<string[]> {
  return getRedis().smembers(USERS_KEY);
}
