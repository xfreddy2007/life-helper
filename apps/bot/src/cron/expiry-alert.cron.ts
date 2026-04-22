import cron from 'node-cron';
import type { messagingApi } from '@line/bot-sdk';
import { getExpiryAlertBatches } from '@life-helper/database/repositories';
import { formatExpiryAlert } from '../lib/format.js';
import { logger } from '../lib/logger.js';
import { getRegisteredUsers } from '../services/user-registry.service.js';

/**
 * Runs on the configured schedule (default 08:00 Asia/Taipei daily).
 *
 * Fetches all batches with an expiry date and groups them into:
 *   - Expired       (expiryDate < today)
 *   - Expires today (expiryDate = today)
 *   - Expires within the next 7 days
 *
 * No deduplication — every run reflects the current state of all batches.
 * A push message is sent whenever any category is non-empty.
 */
export function scheduleExpiryAlertCron(
  lineClient: messagingApi.MessagingApiClient,
  groupId: string,
  expression = '0 8 * * *',
): cron.ScheduledTask {
  return cron.schedule(
    expression,
    async () => {
      logger.info('Running expiry alert cron');
      try {
        const { expired, expiresToday, expiresInWeek } = await getExpiryAlertBatches();

        if (expired.length === 0 && expiresToday.length === 0 && expiresInWeek.length === 0) {
          logger.info('No expiry alerts to send');
          return;
        }

        const message = formatExpiryAlert({ expired, expiresToday, expiresInWeek });
        const userIds = await getRegisteredUsers();
        const recipients = [groupId, ...userIds];
        await Promise.all(
          recipients.map((to) =>
            lineClient.pushMessage({ to, messages: [{ type: 'text', text: message }] }),
          ),
        );

        logger.info(
          {
            expired: expired.length,
            expiresToday: expiresToday.length,
            expiresInWeek: expiresInWeek.length,
            recipientCount: recipients.length,
          },
          'Expiry alert sent',
        );
      } catch (err) {
        logger.error({ err }, 'Expiry alert cron failed');
      }
    },
    { timezone: 'Asia/Taipei' },
  );
}
