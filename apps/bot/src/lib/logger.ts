import pino from 'pino';

export const logger = pino(
  process.env['NODE_ENV'] === 'development'
    ? {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
    : { level: 'info' },
);
