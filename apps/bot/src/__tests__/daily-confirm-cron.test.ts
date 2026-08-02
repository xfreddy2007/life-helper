import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────

const scheduled: Array<() => Promise<void>> = [];

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expr: string, fn: () => Promise<void>) => {
      scheduled.push(fn);
      return { stop: vi.fn() };
    }),
  },
}));

const listItems = vi.fn();
const hasManualConsumptionBetween = vi.fn();

vi.mock('@life-helper/database/repositories', () => ({
  listItems: (...args: unknown[]) => listItems(...args),
  hasManualConsumptionBetween: (...args: unknown[]) => hasManualConsumptionBetween(...args),
}));

const redisStore = new Map<string, string>();
const redis = {
  get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => {
    redisStore.set(k, v);
    return 'OK';
  }),
  del: vi.fn(async (k: string) => {
    redisStore.delete(k);
    return 1;
  }),
  incr: vi.fn(),
  expire: vi.fn(),
};

vi.mock('../lib/redis.js', () => ({
  getRedis: () => redis,
  closeRedis: vi.fn(),
}));

vi.mock('@life-helper/database', () => ({
  prisma: {},
}));

const { scheduleDailyConfirmCrons } = await import('../cron/daily-confirm.cron.js');
const { taipeiDayBounds, hasConsumptionSession } =
  await import('../services/daily-confirm.service.js');

// ── Fixtures ──────────────────────────────────────────────────

// 2026-04-15 23:00 Taipei — the push cron's trigger moment
const PUSH_NOW = new Date('2026-04-15T23:00:00+08:00');
// 2026-04-16 07:00 Taipei — the reminder cron's trigger moment
const REMIND_NOW = new Date('2026-04-16T07:00:00+08:00');

const ITEM = {
  id: 'item-1',
  name: '白米',
  consumptionRate: 7,
  units: ['kg'],
  expiryBatches: [],
};

function makeAdapter(): {
  pushed: Array<{ channelId: string; text: string }>;
  config: Parameters<typeof scheduleDailyConfirmCrons>[0][number];
} {
  const pushed: Array<{ channelId: string; text: string }> = [];
  return {
    pushed,
    config: {
      adapter: {
        push: vi.fn(async (channelId: string, messages: Array<{ text: string }>) => {
          for (const m of messages) pushed.push({ channelId, text: m.text });
        }),
      },
      getChannelIds: vi.fn(async () => ['C1']),
    } as unknown as Parameters<typeof scheduleDailyConfirmCrons>[0][number],
  };
}

/** Schedule the crons and return [pushCron, reminderCron] callbacks. */
function schedule(cfg: Parameters<typeof scheduleDailyConfirmCrons>[0][number]) {
  scheduled.length = 0;
  scheduleDailyConfirmCrons([cfg]);
  return { runPush: scheduled[0]!, runReminder: scheduled[1]! };
}

beforeEach(() => {
  vi.useFakeTimers();
  redisStore.clear();
  listItems.mockReset().mockResolvedValue([ITEM]);
  hasManualConsumptionBetween.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── taipeiDayBounds ───────────────────────────────────────────

describe('taipeiDayBounds', () => {
  it('spans a full Taipei calendar day as a half-open UTC interval', () => {
    const { start, end } = taipeiDayBounds('2026-04-15');
    expect(start.toISOString()).toBe('2026-04-14T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-04-15T16:00:00.000Z');
  });
});

// ── hasConsumptionSession ─────────────────────────────────────

describe('hasConsumptionSession', () => {
  it('queries the whole Taipei day when no cap is given', async () => {
    await hasConsumptionSession('2026-04-15');
    const [start, end] = hasManualConsumptionBetween.mock.calls[0]!;
    expect((start as Date).toISOString()).toBe('2026-04-14T16:00:00.000Z');
    expect((end as Date).toISOString()).toBe('2026-04-15T16:00:00.000Z');
  });

  it('caps the window at `until` when it falls inside the day', async () => {
    await hasConsumptionSession('2026-04-15', PUSH_NOW);
    const [, end] = hasManualConsumptionBetween.mock.calls[0]!;
    expect((end as Date).toISOString()).toBe('2026-04-15T15:00:00.000Z');
  });

  it('ignores `until` when it is past the end of the day', async () => {
    await hasConsumptionSession('2026-04-15', REMIND_NOW);
    const [, end] = hasManualConsumptionBetween.mock.calls[0]!;
    expect((end as Date).toISOString()).toBe('2026-04-15T16:00:00.000Z');
  });

  it('returns false without querying when the window is empty', async () => {
    const result = await hasConsumptionSession('2026-04-15', new Date('2026-04-14T00:00:00Z'));
    expect(result).toBe(false);
    expect(hasManualConsumptionBetween).not.toHaveBeenCalled();
  });
});

// ── Push cron (23:00) ─────────────────────────────────────────

describe('daily confirm push cron', () => {
  it('skips the prompt when a consumption session already happened today', async () => {
    vi.setSystemTime(PUSH_NOW);
    hasManualConsumptionBetween.mockResolvedValue(true);

    const { pushed, config } = makeAdapter();
    await schedule(config).runPush();

    expect(pushed).toHaveLength(0);
    expect(redisStore.get('daily_confirm:2026-04-15')).toBeUndefined();
  });

  it('sends the prompt when no consumption was recorded today', async () => {
    vi.setSystemTime(PUSH_NOW);

    const { pushed, config } = makeAdapter();
    await schedule(config).runPush();

    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.text).toContain('今日消耗確認');
    expect(redisStore.get('daily_confirm:2026-04-15')).toBe('SENT');
  });

  it('does not query items when a session already exists', async () => {
    vi.setSystemTime(PUSH_NOW);
    hasManualConsumptionBetween.mockResolvedValue(true);

    const { config } = makeAdapter();
    await schedule(config).runPush();

    expect(listItems).not.toHaveBeenCalled();
  });
});

// ── Reminder cron (07:00) ─────────────────────────────────────

describe('daily confirm reminder cron', () => {
  it('does not remind when yesterday was never prompted', async () => {
    vi.setSystemTime(REMIND_NOW);

    const { pushed, config } = makeAdapter();
    await schedule(config).runReminder();

    expect(pushed).toHaveLength(0);
  });

  it('does not remind when a late consumption reply arrived after the prompt', async () => {
    vi.setSystemTime(REMIND_NOW);
    redisStore.set('daily_confirm:2026-04-15', 'SENT');
    hasManualConsumptionBetween.mockResolvedValue(true);

    const { pushed, config } = makeAdapter();
    await schedule(config).runReminder();

    expect(pushed).toHaveLength(0);
    expect(redis.del).toHaveBeenCalledWith('no_reply_streak');
  });

  it('reminds when the prompt went unanswered and nothing was consumed', async () => {
    vi.setSystemTime(REMIND_NOW);
    redisStore.set('daily_confirm:2026-04-15', 'SENT');

    const { pushed, config } = makeAdapter();
    await schedule(config).runReminder();

    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.text).toContain('昨日消耗確認未回覆');
  });
});
