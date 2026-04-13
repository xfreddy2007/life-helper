import { validateSignature } from '@line/bot-sdk';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

/**
 * Verifies the X-Line-Signature header on incoming LINE webhook requests.
 * Must be applied BEFORE express.json() so the raw body is available.
 */
export function lineSignatureMiddleware(channelSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.headers['x-line-signature'];

    if (!signature || typeof signature !== 'string') {
      logger.warn('LINE webhook: missing X-Line-Signature header');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    // req.body is the raw Buffer when express.raw() is used upstream
    const body = req.body as Buffer;

    if (!validateSignature(body, channelSecret, signature)) {
      logger.warn('LINE webhook: invalid signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    next();
  };
}
