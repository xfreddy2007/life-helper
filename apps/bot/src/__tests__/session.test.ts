import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSession, setSession, clearSession, newSession } from '../services/session.js';

// Mock Redis
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();

vi.mock('../lib/redis.js', () => ({
  getRedis: () => ({
    get: mockGet,
    set: mockSet,
    del: mockDel,
  }),
}));

describe('Session service', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockDel.mockReset();
  });

  it('returns null when session does not exist', async () => {
    mockGet.mockResolvedValueOnce(null);
    const result = await getSession('group-123');
    expect(result).toBeNull();
    expect(mockGet).toHaveBeenCalledWith('session:group-123');
  });

  it('returns parsed session when it exists', async () => {
    const state = newSession('ONBOARDING');
    mockGet.mockResolvedValueOnce(JSON.stringify(state));

    const result = await getSession('group-123');
    expect(result?.flow).toBe('ONBOARDING');
    expect(result?.step).toBe(0);
  });

  it('returns null on invalid JSON', async () => {
    mockGet.mockResolvedValueOnce('{invalid json}');
    const result = await getSession('group-123');
    expect(result).toBeNull();
  });

  it('sets session with correct key and TTL', async () => {
    mockSet.mockResolvedValueOnce('OK');
    const state = newSession('RECEIPT_IMPORT');

    await setSession('user-456', state);
    expect(mockSet).toHaveBeenCalledWith(
      'session:user-456',
      expect.any(String),
      'EX',
      1800, // 30 minutes
    );
  });

  it('clears session', async () => {
    mockDel.mockResolvedValueOnce(1);
    await clearSession('group-123');
    expect(mockDel).toHaveBeenCalledWith('session:group-123');
  });

  it('newSession creates state with null flow', () => {
    const state = newSession();
    expect(state.flow).toBeNull();
    expect(state.step).toBe(0);
    expect(state.data).toEqual({});
    expect(state.expiresAt).toBeGreaterThan(Date.now());
  });

  it('newSession creates state with specified flow', () => {
    const state = newSession('RESTOCK_CONFIRM');
    expect(state.flow).toBe('RESTOCK_CONFIRM');
  });
});
