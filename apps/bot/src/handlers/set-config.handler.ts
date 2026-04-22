import type { NluResult } from '../services/nlu/schema.js';
import type { ReplyMessage } from './intent-router.js';
import {
  getCronConfig,
  setCronSchedule,
  type CronKey,
  type CronSchedule,
  CRON_LABELS,
  formatSchedule,
} from '../services/cron-config.service.js';
import { cronManager } from '../cron/cron-manager.js';
import { toExpression } from '../cron/cron-manager.js';
import cron from 'node-cron';

/** Returns all current cron schedules as a readable summary. */
async function buildConfigSummary(): Promise<string> {
  const config = await getCronConfig();
  const lines = (Object.keys(CRON_LABELS) as CronKey[]).map(
    (key) => `• ${CRON_LABELS[key]}：${formatSchedule(key, config[key])}`,
  );
  return `⚙️ 目前排程設定：\n${lines.join('\n')}`;
}

/**
 * Converts the NLU config entity into a CronSchedule.
 * Returns null when the entity has no actionable timing information.
 */
function buildSchedule(cfg: NonNullable<NluResult['entities']['config']>): CronSchedule | null {
  // Interval mode takes priority
  if (cfg.intervalSeconds) return { intervalSeconds: cfg.intervalSeconds };
  if (cfg.intervalMinutes) return { intervalMinutes: cfg.intervalMinutes };
  if (cfg.intervalHours) return { intervalHours: cfg.intervalHours };

  // Time mode requires at least an hour
  if (cfg.hour != null) {
    return {
      hour: cfg.hour,
      minute: cfg.minute ?? 0,
      ...(cfg.weekdays && cfg.weekdays.length > 0 ? { weekdays: cfg.weekdays } : {}),
    };
  }

  return null;
}

export async function handleSetConfig(nlu: NluResult): Promise<ReplyMessage[]> {
  const cfg = nlu.entities.config;

  // No config entity, or entity has no actionable timing fields → show current settings
  const hasInterval = cfg && (cfg.intervalSeconds || cfg.intervalMinutes || cfg.intervalHours);
  const isViewRequest = !cfg || (!hasInterval && cfg.cronKey == null && cfg.hour == null);
  if (isViewRequest) {
    const summary = await buildConfigSummary();
    return [
      {
        type: 'text',
        text:
          summary +
          '\n\n您可以說：\n' +
          '• 「每天晚上 10 點提醒消耗確認」\n' +
          '• 「每天早上 7 點發到期提醒」\n' +
          '• 「每週一三五 23:00 發採購清單」\n' +
          '• 「每 30 分鐘發一次到期提醒」',
      },
    ];
  }

  // Timing provided but no cronKey — ask which schedule to update
  if (!cfg.cronKey) {
    return [
      {
        type: 'text',
        text:
          '請告訴我要調整哪個排程：\n' +
          '• 「每天晚上 10 點提醒消耗確認」\n' +
          '• 「每天早上 7 點發到期提醒」\n' +
          '• 「每週五早上 9 點發採購清單」',
      },
    ];
  }

  const schedule = buildSchedule(cfg);
  if (!schedule) {
    return [
      {
        type: 'text',
        text: '請告訴我時間，例如：「每天晚上 10 點」、「每 30 分鐘」或「每週一三五 23:00」',
      },
    ];
  }

  // Validate the resulting cron expression before saving
  const key = cfg.cronKey as CronKey;
  const expression = toExpression(key, schedule);
  if (!cron.validate(expression)) {
    return [
      {
        type: 'text',
        text: `排程格式無效（${expression}），請重新輸入。`,
      },
    ];
  }

  await setCronSchedule(key, schedule);
  await cronManager.reschedule(key);

  const formatted = formatSchedule(key, schedule);
  const summary = await buildConfigSummary();

  return [
    {
      type: 'text',
      text: `✅ 已更新「${CRON_LABELS[key]}」排程為 ${formatted}。\n\n${summary}`,
    },
  ];
}
