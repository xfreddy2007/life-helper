import { getRedis } from '../lib/redis.js';

const REDIS_KEY = 'cron:config';

export type CronKey = 'DAILY_CONFIRM_PUSH' | 'EXPIRY_ALERT' | 'WEEKLY_PURCHASE';

/**
 * Flexible schedule — exactly one mode should be populated:
 *
 * Interval mode  : set one of intervalSeconds / intervalMinutes / intervalHours
 * Time mode      : set hour + minute; optionally weekdays ([] = every day)
 */
export interface CronSchedule {
  // ── Interval mode ──────────────────────────────────────────
  intervalSeconds?: number; // every N seconds  → cron "* /N * * * * *"
  intervalMinutes?: number; // every N minutes  → cron "* /N * * * *"
  intervalHours?: number; // every N hours    → cron "0 * /N * * *"
  // ── Time mode ──────────────────────────────────────────────
  hour?: number; // 0-23
  minute?: number; // 0-59
  weekdays?: number[]; // 0=Sun … 6=Sat; empty / undefined = every day
}

export interface CronConfig {
  DAILY_CONFIRM_PUSH: CronSchedule;
  EXPIRY_ALERT: CronSchedule;
  WEEKLY_PURCHASE: CronSchedule;
}

export const CRON_DEFAULTS: CronConfig = {
  DAILY_CONFIRM_PUSH: { hour: 23, minute: 0 },
  EXPIRY_ALERT: { hour: 8, minute: 0 },
  WEEKLY_PURCHASE: { hour: 10, minute: 0, weekdays: [0] },
};

export const CRON_LABELS: Record<CronKey, string> = {
  DAILY_CONFIRM_PUSH: '每日消耗確認推送',
  EXPIRY_ALERT: '每日到期提醒',
  WEEKLY_PURCHASE: '每週採購清單',
};

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export function formatSchedule(_key: CronKey, s: CronSchedule): string {
  if (s.intervalSeconds) return `每 ${s.intervalSeconds} 秒`;
  if (s.intervalMinutes) return `每 ${s.intervalMinutes} 分鐘`;
  if (s.intervalHours) return `每 ${s.intervalHours} 小時`;

  const h = s.hour ?? 0;
  const m = s.minute ?? 0;
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  if (s.weekdays && s.weekdays.length > 0) {
    const days = s.weekdays.map((d) => WEEKDAY_LABELS[d]).join('、');
    return `每週${days} ${time}`;
  }
  return `每天 ${time}`;
}

export async function getCronConfig(): Promise<CronConfig> {
  const raw = await getRedis().get(REDIS_KEY);
  if (!raw) return { ...CRON_DEFAULTS };
  try {
    const stored = JSON.parse(raw) as Partial<CronConfig>;
    return {
      DAILY_CONFIRM_PUSH: stored.DAILY_CONFIRM_PUSH ?? CRON_DEFAULTS.DAILY_CONFIRM_PUSH,
      EXPIRY_ALERT: stored.EXPIRY_ALERT ?? CRON_DEFAULTS.EXPIRY_ALERT,
      WEEKLY_PURCHASE: stored.WEEKLY_PURCHASE ?? CRON_DEFAULTS.WEEKLY_PURCHASE,
    };
  } catch {
    return { ...CRON_DEFAULTS };
  }
}

export async function setCronSchedule(key: CronKey, schedule: CronSchedule): Promise<void> {
  const config = await getCronConfig();
  config[key] = schedule;
  await getRedis().set(REDIS_KEY, JSON.stringify(config));
}
