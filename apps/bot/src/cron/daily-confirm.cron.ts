import cron from 'node-cron';
import { listItems } from '@life-helper/database/repositories';
import {
  buildDailyEstimates,
  applyDailyEstimates,
  setDailyConfirmSent,
  isDailyConfirmPending,
  incrementNoReplyStreak,
  resetNoReplyStreak,
  todayString,
} from '../services/daily-confirm.service.js';
import { formatDailyConfirm } from '../lib/format.js';
import { logger } from '../lib/logger.js';
import type { AdapterConfig } from '../adapters/types.js';

async function pushToAdapters(adapters: AdapterConfig[], text: string): Promise<void> {
  await Promise.all(
    adapters.map(async ({ adapter, getChannelIds }) => {
      const channelIds = await getChannelIds();
      await Promise.all(channelIds.map((id) => adapter.push(id, [{ type: 'text', text }])));
    }),
  );
}

/**
 * Schedules two daily crons:
 *
 * pushExpression (default "0 23 * * *") — Push estimated consumption for user confirmation.
 * 07:00 Asia/Taipei — If yesterday's confirmation was never received,
 *                     auto-apply daily estimates and escalate after 3 days.
 *
 * Returns both tasks so the caller can stop them on shutdown.
 */
export function scheduleDailyConfirmCrons(
  adapters: AdapterConfig[],
  pushExpression = '0 23 * * *',
): [cron.ScheduledTask, cron.ScheduledTask] {
  // ── Push — Send daily confirmation prompt ──────────────────
  const pushTask = cron.schedule(
    pushExpression,
    async () => {
      logger.info('Running daily confirm push cron');
      try {
        const items = await listItems();
        const estimates = buildDailyEstimates(items);

        if (estimates.length === 0) {
          logger.info('No tracked items, skipping daily confirm push');
          return;
        }

        const today = todayString();
        await setDailyConfirmSent(today);

        const message = formatDailyConfirm(estimates);
        await pushToAdapters(adapters, message);

        logger.info({ itemCount: estimates.length }, 'Daily confirm push sent');
      } catch (err) {
        logger.error({ err }, 'Daily confirm push cron failed');
      }
    },
    { timezone: 'Asia/Taipei' },
  );

  // ── 07:00 — Auto-estimate if yesterday unconfirmed ─────────
  const autoTask = cron.schedule(
    '0 7 * * *',
    async () => {
      logger.info('Running daily auto-estimate cron');
      try {
        const yesterday = todayString(new Date(Date.now() - 24 * 60 * 60 * 1000));
        const pending = await isDailyConfirmPending(yesterday);

        if (!pending) {
          await resetNoReplyStreak();
          logger.info('Yesterday confirmed, streak reset');
          return;
        }

        const results = await applyDailyEstimates();
        const streak = await incrementNoReplyStreak();

        if (results.length === 0) {
          logger.info('Auto-estimate: nothing to deduct (all items at 0)');
          return;
        }

        let message = `🤖 昨日未回覆，已自動記錄消耗：\n─────────────────\n${results.join('\n')}`;

        if (streak >= 3) {
          message += `\n\n⚠️ 已連續 ${streak} 天未確認，建議重新盤點庫存！\n傳「開始盤點」重新確認庫存`;
        }

        await pushToAdapters(adapters, message);
        logger.info({ streak, estimatedCount: results.length }, 'Auto-estimate applied');
      } catch (err) {
        logger.error({ err }, 'Auto-estimate cron failed');
      }
    },
    { timezone: 'Asia/Taipei' },
  );

  logger.info({ pushExpression }, 'Daily confirm crons scheduled (Asia/Taipei)');
  return [pushTask, autoTask];
}
