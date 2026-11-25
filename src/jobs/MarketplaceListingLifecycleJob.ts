import AppDataSource from '../config/db';
import logger from '../config/logger';
import {
  LifecycleReport,
  MarketplaceListingService,
  SweepOptions,
} from '../services/Marketplace/MarketplaceListingService';

/**
 * Issue #920: moves expired and failed marketplace listings to a terminal
 * status and prunes the rows that have been terminal for too long.
 *
 * Intended to run on a schedule (cron / Kubernetes CronJob) and on demand —
 * `--job=marketplace-listings` on the distributed scheduler, or this file
 * directly.
 */
export async function runMarketplaceListingLifecycleJob(
  options: SweepOptions = {},
): Promise<LifecycleReport> {
  const service = new MarketplaceListingService();
  const report = await service.sweep(options);
  if (report.scanned > 0) {
    logger.info(
      {
        scanned: report.scanned,
        expired: report.expired,
        failed: report.failed,
        pruned: report.pruned,
      },
      'Marketplace listing lifecycle job finished',
    );
  }
  return report;
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async () => {
      await runMarketplaceListingLifecycleJob();
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      logger.error({ err: error }, 'Marketplace listing lifecycle job failed');
      process.exit(1);
    });
}
