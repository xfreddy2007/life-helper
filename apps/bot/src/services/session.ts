import { getRedis } from '../lib/redis.js';

export type ConversationFlow =
  | 'RECEIPT_IMPORT'
  | 'ONBOARDING'
  | 'RESTOCK_CONFIRM'
  | 'RESET_CONFIRM'
  | 'RESTOCK_EXPIRY'
  | 'PARTIAL_RESET_CONFIRM'
  | 'REVERT_SELECT'
  | 'SESSION_INTERRUPT';

export interface ConversationState {
  flow: ConversationFlow | null;
  step: number;
  data: Record<string, unknown>;
  expiresAt: number; // Unix timestamp ms
}

const SESSION_TTL_SECONDS = 30 * 60; // 30 minutes

function sessionKey(id: string): string {
  return `session:${id}`;
}

export async function getSession(id: string): Promise<ConversationState | null> {
  const redis = getRedis();
  const raw = await redis.get(sessionKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConversationState;
  } catch {
    return null;
  }
}

export async function setSession(id: string, state: ConversationState): Promise<void> {
  const redis = getRedis();
  await redis.set(sessionKey(id), JSON.stringify(state), 'EX', SESSION_TTL_SECONDS);
}

export async function clearSession(id: string): Promise<void> {
  const redis = getRedis();
  await redis.del(sessionKey(id));
}

export function newSession(flow: ConversationFlow | null = null): ConversationState {
  return {
    flow,
    step: 0,
    data: {},
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
}
