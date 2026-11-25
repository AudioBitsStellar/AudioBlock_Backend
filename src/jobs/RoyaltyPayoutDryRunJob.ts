import AppDataSource from '../config/db';
import logger from '../config/logger';
import { RoyaltyPayoutDryRunService } from '../services/RoyaltyPayoutDryRunService';
import {
  evaluatePayoutEnablement,
  getRoyaltyPayoutMode,
  isRoyaltyPayoutReportingAllowed,
} from '../config/royaltyPayoutMode';
import type { RoyaltyPayoutDryRunReport } from '../types';

/**
 * Produce the #919 dry-run report over the payouts a reconciliation pass would
 * touch, persisting nothing.
 *
 * @returns The report, or null when `ROYALTY_PAYOUT_MODE=disabled` says this
 *   deployment must not process royalties at all — including read-only.
 */
export async function runRoyaltyPayoutDryRunJob(): Promise<RoyaltyPayoutDryRunReport | null> {
  if (!isRoyaltyPayoutReportingAllowed()) {
    logger.warn(
      { mode: getRoyaltyPayoutMode() },
      'Royalty payout dry run refused: ROYALTY_PAYOUT_MODE=disabled',
    );
    return null;
  }

  const report = await new RoyaltyPayoutDryRunService().generateReport();

  logger.info({ report }, 'Royalty payout dry-run report');
  return report;
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async () => {
      const report = await runRoyaltyPayoutDryRunJob();
      if (!report) {
        process.exitCode = 1;
        return;
      }

      // No reconciliation pass has run inside this process, so the verdict is
      // computed from an absent report — which is the point: the sign-off
      // sequence is dry-run report, then a passing reconciliation, then `enabled`.
      const { armed, reasons } = evaluatePayoutEnablement(null);
      logger.info({ armed, reasons }, 'Royalty payout enablement verdict');
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      logger.error({ err: error }, 'Royalty payout dry run failed');
      process.exit(1);
    });
}
