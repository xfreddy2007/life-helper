import type { NluService } from '../services/nlu/nlu.service.js';
import type { ReplyMessage } from '../handlers/intent-router.js';
import { getSession } from '../services/session.js';
import { routeIntent } from '../handlers/intent-router.js';
import { logger } from '../lib/logger.js';

/**
 * Platform-agnostic text message processor.
 * Parses intent via NLU, loads session state, routes to the appropriate handler,
 * and returns reply messages. Does not perform any platform I/O.
 */
export async function processTextMessage(
  text: string,
  sourceId: string,
  nluService: NluService,
): Promise<ReplyMessage[]> {
  logger.info({ sourceId, text }, 'Processing text message');
  const [nluResult, session] = await Promise.all([nluService.parse(text), getSession(sourceId)]);
  return routeIntent({ nluResult, session, sourceId });
}
