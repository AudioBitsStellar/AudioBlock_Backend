import AppDataSource from '../config/db';
import {
  OnChainReconciliationService,
  ReconciliationReport,
} from '../services/OnChainReconciliationService';
import { JobQueueService } from '../services/JobQueueService';
import { registerJobHandler } from '../workers/JobQueueWorker';
import logger from '../config/logger';

export const ON_CHAIN_RECONCILIATION_JOB_TYPE = 'reconcile_onchain_events';

/**
 * Execute the on-chain reconciliation job.
 */
export async function runOnChainReconciliationJob(
  lookbackHours = 24,
): Promise<ReconciliationReport> {
  const service = new OnChainReconciliationService();
  return service.reconcile(lookbackHours);
}

/**
 * Enqueue a reconciliation job to run asynchronously via JobQueueService.
 */
export async function scheduleOnChainReconciliationJob(lookbackHours = 24) {
  return JobQueueService.enqueue(
    ON_CHAIN_RECONCILIATION_JOB_TYPE,
    { lookbackHours },
    { priority: 'low' },
  );
}

/**
 * Register the job handler on the background JobQueueWorker.
 */
export function registerOnChainReconciliationHandler(): void {
  registerJobHandler(ON_CHAIN_RECONCILIATION_JOB_TYPE, async (job) => {
    const lookback = job.payload?.lookbackHours ?? 24;
    const report = await runOnChainReconciliationJob(lookback);
    if (report.mismatches.length > 0) {
      logger.warn(
        { count: report.mismatches.length },
        'On-chain reconciliation background job found discrepancies',
      );
    }
  });
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async () => {
      const report = await runOnChainReconciliationJob();
      if (report.mismatches.length > 0) {
        logger.warn(
          `On-chain reconciliation finished with ${report.mismatches.length} mismatch(es)`,
        );
      }
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      logger.error({ err: error }, 'On-chain reconciliation job failed');
      process.exit(1);
    });
}
