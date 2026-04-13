import cron from 'node-cron';
import type { messagingApi } from '@line/bot-sdk';
import {
  getApproachingBatches,
  getExpiredBatches,
  markBatchesAlertSent,
} from '@life-helper/database/repositories';
import { formatExpiryAlert } from '../lib/format.js';
import { logger } from '../lib/logger.js';

/**
 * Number of days ahead to consider a batch "approaching expiry".
 * Matches the Category.defaultExpiryAlertDays default in the schema.
 */
const ALERT_WINDOW_DAYS = 7;

/**
 * Runs every day at 08:00 Asia/Taipei.
 *
 * Checks for:
 * - Batches expiring within ALERT_WINDOW_DAYS days (not yet alerted)
 * - Batches already past their expiry date (not yet alerted)
 *
 * Sends a single push message if any are found, then marks them as alerted
 * so they won't trigger again.
 */
export function scheduleExpiryAlertCron(
  lineClient: messagingApi.MessagingApiClient,
  groupId: string,
): cron.ScheduledTask {
  return cron.schedule(
    '0 8 * * *',
    async () => {
      logger.info('Running expiry alert cron');
      try {
        const [approaching, expired] = await Promise.all([
          getApproachingBatches(ALERT_WINDOW_DAYS),
          getExpiredBatches(),
        ]);

        if (approaching.length === 0 && expired.length === 0) {
          logger.info('No expiry alerts to send');
          return;
        }

        const message = formatExpiryAlert(approaching, expired);
        await lineClient.pushMessage({ to: groupId, messages: [{ type: 'text', text: message }] });

        // Prevent duplicate alerts
        const allIds = [...approaching, ...expired].map((b) => b.id);
        await markBatchesAlertSent(allIds);

        logger.info(
          { approaching: approaching.length, expired: expired.length },
          'Expiry alert sent',
        );
      } catch (err) {
        logger.error({ err }, 'Expiry alert cron failed');
      }
    },
    { timezone: 'Asia/Taipei' },
  );
}
