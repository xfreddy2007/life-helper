import type cron from 'node-cron';
import { logger } from '../lib/logger.js';
import { getCronConfig, type CronKey, type CronSchedule } from '../services/cron-config.service.js';
import { scheduleDailyConfirmCrons } from './daily-confirm.cron.js';
import { scheduleExpiryAlertCron } from './expiry-alert.cron.js';
import { scheduleWeeklyPurchaseReminder } from './weekly-purchase.cron.js';
import type { AdapterConfig } from '../adapters/types.js';

export function toExpression(_key: CronKey, s: CronSchedule): string {
  // Interval mode — uses 6-field (seconds) or 5-field format
  if (s.intervalSeconds) return `*/${s.intervalSeconds} * * * * *`; // 6-field: sec min hr day mon wday
  if (s.intervalMinutes) return `*/${s.intervalMinutes} * * * *`;
  if (s.intervalHours) return `0 */${s.intervalHours} * * *`;

  // Time mode
  const m = s.minute ?? 0;
  const h = s.hour ?? 0;
  if (s.weekdays && s.weekdays.length > 0) {
    return `${m} ${h} * * ${s.weekdays.join(',')}`;
  }
  return `${m} ${h} * * *`;
}

type TaskSlot = {
  DAILY_CONFIRM_PUSH?: cron.ScheduledTask;
  DAILY_AUTO_APPLY?: cron.ScheduledTask;
  EXPIRY_ALERT?: cron.ScheduledTask;
  WEEKLY_PURCHASE?: cron.ScheduledTask;
};

class CronManager {
  private tasks: TaskSlot = {};
  private adapters: AdapterConfig[] = [];

  /** Call once at startup — reads config from Redis and creates all tasks. */
  async init(adapters: AdapterConfig[]): Promise<void> {
    this.adapters = adapters;

    const config = await getCronConfig();

    const pushExpr = toExpression('DAILY_CONFIRM_PUSH', config.DAILY_CONFIRM_PUSH);
    const [pushTask, autoTask] = scheduleDailyConfirmCrons(this.adapters, pushExpr);
    this.tasks.DAILY_CONFIRM_PUSH = pushTask;
    this.tasks.DAILY_AUTO_APPLY = autoTask;

    const expiryExpr = toExpression('EXPIRY_ALERT', config.EXPIRY_ALERT);
    this.tasks.EXPIRY_ALERT = scheduleExpiryAlertCron(this.adapters, expiryExpr);

    const weeklyExpr = toExpression('WEEKLY_PURCHASE', config.WEEKLY_PURCHASE);
    this.tasks.WEEKLY_PURCHASE = scheduleWeeklyPurchaseReminder(this.adapters, weeklyExpr);

    logger.info('All cron tasks initialised via CronManager');
  }

  /** Hot-reload a single cron after its config changes in Redis. */
  async reschedule(key: CronKey): Promise<void> {
    if (this.adapters.length === 0) {
      logger.warn('CronManager.reschedule called before init');
      return;
    }

    const config = await getCronConfig();

    if (key === 'DAILY_CONFIRM_PUSH') {
      this.tasks.DAILY_CONFIRM_PUSH?.stop();
      this.tasks.DAILY_AUTO_APPLY?.stop();
      const expr = toExpression('DAILY_CONFIRM_PUSH', config.DAILY_CONFIRM_PUSH);
      const [pushTask, autoTask] = scheduleDailyConfirmCrons(this.adapters, expr);
      this.tasks.DAILY_CONFIRM_PUSH = pushTask;
      this.tasks.DAILY_AUTO_APPLY = autoTask;
    } else if (key === 'EXPIRY_ALERT') {
      this.tasks.EXPIRY_ALERT?.stop();
      const expr = toExpression('EXPIRY_ALERT', config.EXPIRY_ALERT);
      this.tasks.EXPIRY_ALERT = scheduleExpiryAlertCron(this.adapters, expr);
    } else if (key === 'WEEKLY_PURCHASE') {
      this.tasks.WEEKLY_PURCHASE?.stop();
      const expr = toExpression('WEEKLY_PURCHASE', config.WEEKLY_PURCHASE);
      this.tasks.WEEKLY_PURCHASE = scheduleWeeklyPurchaseReminder(this.adapters, expr);
    }

    logger.info({ key }, 'Cron task rescheduled');
  }

  stopAll(): void {
    for (const task of Object.values(this.tasks)) {
      task?.stop();
    }
    this.tasks = {};
    logger.info('All cron tasks stopped');
  }
}

/** Singleton shared between main.ts and set-config.handler.ts */
export const cronManager = new CronManager();
