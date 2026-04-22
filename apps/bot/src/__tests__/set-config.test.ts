import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetConfig } from '../handlers/set-config.handler.js';
import type { NluResult } from '../services/nlu/schema.js';

vi.mock('../services/cron-config.service.js', () => ({
  getCronConfig: vi.fn().mockResolvedValue({
    DAILY_CONFIRM_PUSH: { hour: 23, minute: 0 },
    EXPIRY_ALERT: { hour: 8, minute: 0 },
    WEEKLY_PURCHASE: { hour: 10, minute: 0, weekdays: [0] },
  }),
  setCronSchedule: vi.fn().mockResolvedValue(undefined),
  CRON_LABELS: {
    DAILY_CONFIRM_PUSH: '每日消耗確認推送',
    EXPIRY_ALERT: '每日到期提醒',
    WEEKLY_PURCHASE: '每週採購清單',
  },
  formatSchedule: vi.fn(
    (
      _key: string,
      s: {
        hour?: number;
        minute?: number;
        weekdays?: number[];
        intervalSeconds?: number;
        intervalMinutes?: number;
        intervalHours?: number;
      },
    ) => {
      if (s.intervalSeconds) return `每 ${s.intervalSeconds} 秒`;
      if (s.intervalMinutes) return `每 ${s.intervalMinutes} 分鐘`;
      if (s.intervalHours) return `每 ${s.intervalHours} 小時`;
      const time = `${s.hour ?? 0}:00`;
      if (s.weekdays?.length) return `每週X ${time}`;
      return `每天 ${time}`;
    },
  ),
}));

vi.mock('../cron/cron-manager.js', () => ({
  cronManager: { reschedule: vi.fn().mockResolvedValue(undefined) },
  toExpression: vi.fn().mockReturnValue('0 23 * * *'),
}));

vi.mock('node-cron', () => ({ default: { validate: vi.fn().mockReturnValue(true) } }));

import { setCronSchedule } from '../services/cron-config.service.js';
import { cronManager } from '../cron/cron-manager.js';

const mockSetCronSchedule = vi.mocked(setCronSchedule);
const mockReschedule = vi.mocked(cronManager.reschedule);

function makeNlu(overrides: Partial<NluResult> = {}): NluResult {
  return { intent: 'SET_CONFIG', entities: {}, rawText: '', confidence: 0.9, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('handleSetConfig', () => {
  it('shows current settings when no config entity', async () => {
    const replies = await handleSetConfig(makeNlu());
    expect(replies[0]!.text).toContain('目前排程設定');
    expect(mockSetCronSchedule).not.toHaveBeenCalled();
  });

  it('shows current settings when config entity has all nulls (view request)', async () => {
    const nlu = makeNlu({ entities: { config: { cronKey: null, hour: null } } });
    const replies = await handleSetConfig(nlu);
    expect(replies[0]!.text).toContain('目前排程設定');
    expect(mockSetCronSchedule).not.toHaveBeenCalled();
  });

  it('asks which schedule when time is given but cronKey is missing', async () => {
    const nlu = makeNlu({ entities: { config: { hour: 10, minute: 0 } } });
    const replies = await handleSetConfig(nlu);
    expect(replies[0]!.text).toContain('要調整哪個排程');
    expect(mockSetCronSchedule).not.toHaveBeenCalled();
  });

  it('asks for time when cronKey given but no timing', async () => {
    const nlu = makeNlu({ entities: { config: { cronKey: 'EXPIRY_ALERT' } } });
    const replies = await handleSetConfig(nlu);
    expect(replies[0]!.text).toContain('時間');
    expect(mockSetCronSchedule).not.toHaveBeenCalled();
  });

  it('updates EXPIRY_ALERT with daily time', async () => {
    const nlu = makeNlu({
      entities: { config: { cronKey: 'EXPIRY_ALERT', hour: 7, minute: 0 } },
    });
    const replies = await handleSetConfig(nlu);
    expect(mockSetCronSchedule).toHaveBeenCalledWith('EXPIRY_ALERT', { hour: 7, minute: 0 });
    expect(mockReschedule).toHaveBeenCalledWith('EXPIRY_ALERT');
    expect(replies[0]!.text).toContain('已更新');
    expect(replies[0]!.text).toContain('每日到期提醒');
  });

  it('updates WEEKLY_PURCHASE with multiple weekdays', async () => {
    const nlu = makeNlu({
      entities: {
        config: { cronKey: 'WEEKLY_PURCHASE', hour: 23, minute: 0, weekdays: [1, 3, 5] },
      },
    });
    const replies = await handleSetConfig(nlu);
    expect(mockSetCronSchedule).toHaveBeenCalledWith('WEEKLY_PURCHASE', {
      hour: 23,
      minute: 0,
      weekdays: [1, 3, 5],
    });
    expect(mockReschedule).toHaveBeenCalledWith('WEEKLY_PURCHASE');
    expect(replies[0]!.text).toContain('每週採購清單');
  });

  it('updates with interval seconds', async () => {
    const nlu = makeNlu({
      entities: { config: { cronKey: 'DAILY_CONFIRM_PUSH', intervalSeconds: 10 } },
    });
    const replies = await handleSetConfig(nlu);
    expect(mockSetCronSchedule).toHaveBeenCalledWith('DAILY_CONFIRM_PUSH', { intervalSeconds: 10 });
    expect(mockReschedule).toHaveBeenCalledWith('DAILY_CONFIRM_PUSH');
    expect(replies[0]!.text).toContain('每日消耗確認推送');
  });

  it('updates with interval minutes', async () => {
    const nlu = makeNlu({
      entities: { config: { cronKey: 'EXPIRY_ALERT', intervalMinutes: 30 } },
    });
    await handleSetConfig(nlu);
    expect(mockSetCronSchedule).toHaveBeenCalledWith('EXPIRY_ALERT', { intervalMinutes: 30 });
    expect(mockReschedule).toHaveBeenCalledWith('EXPIRY_ALERT');
  });

  it('updates with interval hours', async () => {
    const nlu = makeNlu({
      entities: { config: { cronKey: 'WEEKLY_PURCHASE', intervalHours: 2 } },
    });
    await handleSetConfig(nlu);
    expect(mockSetCronSchedule).toHaveBeenCalledWith('WEEKLY_PURCHASE', { intervalHours: 2 });
  });

  it('defaults minute to 0 when not provided', async () => {
    const nlu = makeNlu({
      entities: { config: { cronKey: 'DAILY_CONFIRM_PUSH', hour: 22 } },
    });
    await handleSetConfig(nlu);
    expect(mockSetCronSchedule).toHaveBeenCalledWith('DAILY_CONFIRM_PUSH', {
      hour: 22,
      minute: 0,
    });
  });

  it('asks which schedule when only interval given without cronKey', async () => {
    const nlu = makeNlu({ entities: { config: { intervalMinutes: 30 } } });
    const replies = await handleSetConfig(nlu);
    expect(replies[0]!.text).toContain('要調整哪個排程');
    expect(mockSetCronSchedule).not.toHaveBeenCalled();
  });
});
