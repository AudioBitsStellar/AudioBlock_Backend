/**
 * Job scheduler — runs recurring maintenance jobs on configurable intervals.
 *
 * Each job is guarded by a Redis SET NX lock so only one scheduler instance
 * executes a given job concurrently, even when multiple pods are deployed.
 *
 * Env vars (all optional, values in milliseconds):
 *   SCHED_ROYALTY_RECONCILE_MS      default: 6 hours
 *   SCHED_ONCHAIN_RECONCILE_MS      default: 6 hours
 *   SCHED_GDPR_PURGE_MS             default: 24 hours
 *   SCHED_PLAYBACK_AGGREGATION_MS   default: 24 hours
 *
 * Start: npm run scheduler
 */

import AppDataSource from '../config/db';
import redis from '../config/redis';
import logger from '../config/logger';
import { runRoyaltyReconciliationJob } from '../jobs/RoyaltyReconciliationJob';
import { runAccountDeletionJob } from '../jobs/AccountDeletionJob';
import { runOnChainReconciliationJob } from '../jobs/OnChainReconciliationJob';
import { runPlaybackAggregationJob } from '../jobs/DailyPlaybackAggregationJob';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

interface JobDef {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

const JOBS: JobDef[] = [
  {
    name: 'royalty_reconcile',
    intervalMs: Number(process.env.SCHED_ROYALTY_RECONCILE_MS ?? SIX_HOURS),
    run: runRoyaltyReconciliationJob,
  },
  {
    name: 'onchain_reconcile',
    intervalMs: Number(process.env.SCHED_ONCHAIN_RECONCILE_MS ?? SIX_HOURS),
    run: () => runOnChainReconciliationJob(),
  },
  {
    name: 'gdpr_purge',
    intervalMs: Number(process.env.SCHED_GDPR_PURGE_MS ?? ONE_DAY),
    run: () => runAccountDeletionJob(),
  },
  {
    name: 'playback_aggregation',
    intervalMs: Number(process.env.SCHED_PLAYBACK_AGGREGATION_MS ?? ONE_DAY),
    run: runPlaybackAggregationJob,
  },
];

async function withLock(jobName: string, ttlMs: number, fn: () => Promise<void>): Promise<void> {
  const key = `scheduler:lock:${jobName}`;
  // SET NX PX — only one instance wins; losers skip silently.
  const acquired = await redis.set(key, '1', 'NX', 'PX', ttlMs);
  if (!acquired) {
    logger.debug(`[scheduler] ${jobName}: lock held by another instance, skipping`);
    return;
  }
  const start = Date.now();
  try {
    logger.info(`[scheduler] ${jobName}: starting`);
    await fn();
    logger.info(`[scheduler] ${jobName}: done (${Date.now() - start}ms)`);
  } catch (err) {
    logger.error(`[scheduler] ${jobName}: failed after ${Date.now() - start}ms`, { err });
  } finally {
    await redis.del(key);
  }
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  logger.info('[scheduler] database initialised');

  for (const job of JOBS) {
    // Run once immediately on startup, then on the configured interval.
    void withLock(job.name, job.intervalMs, job.run);
    setInterval(() => void withLock(job.name, job.intervalMs, job.run), job.intervalMs);
    logger.info(`[scheduler] ${job.name}: scheduled every ${job.intervalMs}ms`);
  }
}

main().catch((err) => {
  logger.error('[scheduler] fatal startup error', { err });
  process.exit(1);
});
