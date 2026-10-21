import AppDataSource from '../config/db';
import logger from '../config/logger';
import { WebhookService } from '../services/WebhookService';

/**
 * Issue #824: Cleans up webhook delivery records older than 30 days.
 *
 * Intended to run on a schedule (cron / Kubernetes CronJob) and on demand.
 */
export async function runWebhookRetentionJob(days = 30): Promise<number> {
  const service = new WebhookService();
  const deletedCount = await service.cleanupOldDeliveries(days);
  logger.info({ deletedCount, days }, 'Webhook delivery retention job finished');
  return deletedCount;
}

if (require.main === module) {
  const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg ? Number.parseInt(daysArg.split('=')[1], 10) : 30;

  AppDataSource.initialize()
    .then(async () => {
      await runWebhookRetentionJob(Number.isFinite(days) ? days : 30);
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      logger.error({ err: error }, 'Webhook retention job failed');
      process.exit(1);
    });
}
