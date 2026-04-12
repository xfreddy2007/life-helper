import { prisma } from '@life-helper/database';

/**
 * Wraps test code in a transaction and rolls it back after execution.
 * Keeps tests isolated without needing to manually clean up data.
 */
export async function withRollback(fn: () => Promise<void>): Promise<void> {
  await prisma
    .$transaction(async (_tx) => {
      await fn();
      // Force rollback by throwing after test completes
      throw new Error('__rollback__');
    })
    .catch((e: unknown) => {
      if (e instanceof Error && e.message !== '__rollback__') throw e;
    });
}
