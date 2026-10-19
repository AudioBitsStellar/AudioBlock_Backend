import AppDataSource from '../config/db';
import { ReleaseService } from '../services/ReleaseService';
import logger from '../config/logger';

/**
 * Background job to publish scheduled releases when their release time arrives (Issue #423).
 */
export async function runScheduledReleasePublishJob(asOf?: Date): Promise<number> {
  const service = new ReleaseService();
  const published = await service.publishScheduledReleases(asOf);

  if (published.length > 0) {
    logger.info(`ScheduledReleasePublishJob: published ${published.length} release(s)`);
  }
  return published.length;
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async () => {
      await runScheduledReleasePublishJob();
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      console.error('Scheduled release publish job failed:', error);
      process.exit(1);
    });
}
