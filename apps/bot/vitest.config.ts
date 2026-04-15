import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/main.ts',
        // Infrastructure files — wiring only, no testable business logic
        'src/config/**',
        'src/cron/**',
        'src/middleware/**',
        'src/routes/**',
        'src/lib/logger.ts',
        'src/lib/redis.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
