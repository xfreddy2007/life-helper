// This file must be imported first in main.ts so Sentry can instrument
// express and http before they are loaded by any other module.
import * as Sentry from '@sentry/node';
import { env } from './config/env.js';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
  });
}
