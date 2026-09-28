import AppDataSource from '../config/db';
import logger from '../config/logger';
import { AccountDeletionService } from '../services/AccountDeletionService';

/**
 * Executes GDPR erasures whose grace period has elapsed (Issue #633).
 *
 * Intended to run on a schedule (cron / Kubernetes CronJob) *and* on demand.
 * Every account past its deadline is processed, each in its own transaction, so
 * one failure neither rolls back the others nor blocks the queue — the service
 * records a `failed` status and the next pass retries it.
 *
 * Intentionally a standalone script rather than an in-process timer: the erasure
 * is irreversible, so it should be something an operator can trigger, observe, and
 * (if necessary) re-run, rather than something that silently fires from inside an
 * API replica that happens to restart.
 */
export async function runAccountDeletionJob(
  limit?: number,
): Promise<Array<{ userId: string; ok: boolean; error?: string }>> {
  const service = new AccountDeletionService();
  const outcomes = await service.processDueDeletions(limit);

  const succeeded = outcomes.filter((outcome) => outcome.ok).length;
  const failed = outcomes.length - succeeded;

  logger.info({ processed: outcomes.length, succeeded, failed }, 'Account deletion job finished');

  if (failed > 0) {
    logger.error({ failed }, 'Some account erasures failed and will be retried on the next run');
  }

  return outcomes;
}

if (require.main === module) {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : undefined;

  AppDataSource.initialize()
    .then(async () => {
      await runAccountDeletionJob(Number.isFinite(limit) ? limit : undefined);
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      logger.error({ err: error }, 'Account deletion job failed');
      process.exit(1);
    });
}
