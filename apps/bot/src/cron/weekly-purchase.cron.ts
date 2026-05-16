import cron from 'node-cron';
import { listItems, createPurchaseList } from '@life-helper/database/repositories';
import { calculatePurchaseList } from '../services/purchase-advisor.service.js';
import { formatPurchaseList } from '../lib/format.js';
import { logger } from '../lib/logger.js';
import type { AdapterConfig } from '../adapters/types.js';

/**
 * Runs every Sunday at 10:00 Asia/Taipei.
 * Generates a fresh purchase list and pushes it to all configured adapters.
 */
export function scheduleWeeklyPurchaseReminder(
  adapters: AdapterConfig[],
  expression = '0 10 * * 0',
): cron.ScheduledTask {
  const task = cron.schedule(
    expression,
    async () => {
      logger.info('Running weekly purchase reminder cron');

      try {
        const items = await listItems();
        const recommendations = calculatePurchaseList(items);

        if (recommendations.length > 0) {
          await createPurchaseList({
            items: recommendations.map((r) => ({
              itemId: r.itemId,
              suggestedQty: r.suggestedQty,
              unit: r.unit,
              urgency: r.urgency,
              reason: r.reason,
            })),
          });
        }

        const message = formatPurchaseList(recommendations);
        await Promise.all(
          adapters.map(async ({ adapter, getChannelIds }) => {
            const channelIds = await getChannelIds();
            await Promise.all(
              channelIds.map((id) => adapter.push(id, [{ type: 'text', text: message }])),
            );
          }),
        );

        logger.info({ itemCount: recommendations.length }, 'Weekly purchase reminder sent');
      } catch (err) {
        logger.error({ err }, 'Weekly purchase reminder cron failed');
      }
    },
    { timezone: 'Asia/Taipei' },
  );

  logger.info({ expression }, 'Weekly purchase reminder cron scheduled (Asia/Taipei)');
  return task;
}
