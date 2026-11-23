/**
 * Distributed-safe job scheduler (#929).
 *
 * When AudioBlocks runs as multiple horizontally-scaled replicas, every
 * instance would otherwise fire each scheduled job. A Redis SET NX lock
 * (the standard "SETNX + EXPIRE" pattern, done atomically via SET NX EX)
 * ensures only the first replica to acquire the lock actually runs the
 * job; the rest skip that tick.
 *
 * Usage (Kubernetes CronJob or any cron host):
 *   ts-node src/jobs/scheduler.ts --job=daily-playback
 *   ts-node src/jobs/scheduler.ts --job=royalty-reconciliation
 *   ts-node src/jobs/scheduler.ts --job=account-deletion
 *   ts-node src/jobs/scheduler.ts --job=webhook-retention
 *   ts-node src/jobs/scheduler.ts --job=onchain-reconciliation
 *   ts-node src/jobs/scheduler.ts --job=marketplace-listings
 *
 * To run all jobs in one pass (not recommended for production):
 *   ts-node src/jobs/scheduler.ts --job=all
 */

import AppDataSource from '../config/db';
import redis from '../config/redis';
import logger from '../config/logger';
import { runPlaybackAggregationJob } from './DailyPlaybackAggregationJob';
import { runRoyaltyReconciliationJob } from './RoyaltyReconciliationJob';
import { runAccountDeletionJob } from './AccountDeletionJob';
import { runWebhookRetentionJob } from './WebhookRetentionJob';
import { runOnChainReconciliationJob } from './OnChainReconciliationJob';
import { runMarketplaceListingLifecycleJob } from './MarketplaceListingLifecycleJob';

/** TTL for the distributed lock — must exceed the worst-case job duration. */
const LOCK_TTL_SECONDS = 300; // 5 minutes

/**
 * Acquire a Redis distributed lock for `jobName`. Returns true if the lock
 * was acquired (this instance should run the job), false if another instance
 * already holds it.
 */
async function acquireLock(jobName: string): Promise<boolean> {
  const key = `scheduler:lock:${jobName}`;
  // SET NX EX is atomic — only one replica wins.
  const result = await redis.set(key, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
  return result === 'OK';
}

/** Release the lock early so the next cron tick can proceed sooner. */
async function releaseLock(jobName: string): Promise<void> {
  await redis.del(`scheduler:lock:${jobName}`);
}

type JobRunner = () => Promise<void>;

const JOBS: Record<string, JobRunner> = {
  'daily-playback': runPlaybackAggregationJob,
  'royalty-reconciliation': runRoyaltyReconciliationJob,
  'account-deletion': async () => {
    await runAccountDeletionJob();
  },
  'webhook-retention': async () => {
    await runWebhookRetentionJob();
  },
  'onchain-reconciliation': runOnChainReconciliationJob,
  'marketplace-listings': async () => {
    await runMarketplaceListingLifecycleJob();
  },
};

async function runJob(jobName: string): Promise<void> {
  const runner = JOBS[jobName];
  if (!runner) {
    throw new Error(`Unknown job: "${jobName}". Known jobs: ${Object.keys(JOBS).join(', ')}`);
  }

  const acquired = await acquireLock(jobName);
  if (!acquired) {
    logger.info({ job: jobName }, 'Skipping: another instance holds the lock');
    return;
  }

  logger.info({ job: jobName }, 'Lock acquired — running job');
  try {
    await runner();
    logger.info({ job: jobName }, 'Job completed successfully');
  } finally {
    await releaseLock(jobName);
  }
}

if (require.main === module) {
  const jobArg = process.argv.find((a) => a.startsWith('--job='));
  const jobName = jobArg?.split('=')[1];

  if (!jobName) {
    process.stderr.write('Usage: ts-node src/jobs/scheduler.ts --job=<name>\n');
    process.stderr.write(`Known jobs: ${Object.keys(JOBS).join(', ')}, all\n`);
    process.exit(1);
  }

  const jobsToRun = jobName === 'all' ? Object.keys(JOBS) : [jobName];

  AppDataSource.initialize()
    .then(async () => {
      for (const name of jobsToRun) {
        await runJob(name);
      }
    })
    .finally(async () => {
      redis.disconnect();
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((err) => {
      logger.error({ err }, 'Scheduler fatal error');
      process.exit(1);
    });
}

export { acquireLock, releaseLock, runJob, JOBS };
