import AppDataSource from '../config/db';
import logger from '../config/logger';
import { RoyaltyPayoutService } from '../services/RoyaltyPayoutService';
import { toRoyaltyReconciliationReport } from '../services/RoyaltyReconciliationReport';
import { evaluatePayoutEnablement } from '../config/royaltyPayoutMode';
import type { RoyaltyReconciliationReport } from '../types';

/**
 * Reconcile pending royalty payouts against the Soroban royalty contract.
 *
 * It returns the report rather than `void` (Issue #919): the launch checklist
 * requires this pass to succeed before payouts may be armed, and a caller
 * cannot require what a function refuses to express. The return value is
 * ignored by both schedulers, so only the CLI exit status changes behaviour.
 */
export async function runRoyaltyReconciliationJob(): Promise<RoyaltyReconciliationReport> {
  const service = new RoyaltyPayoutService();
  const result = await service.reconcilePendingPayouts();
  const report = toRoyaltyReconciliationReport(result);

  if (!report.passed) {
    logger.error(
      {
        checked: report.checked,
        discrepancies: report.discrepancies,
      },
      `Royalty reconciliation found ${report.discrepancies.length} recipient-level discrepancy(ies)`,
    );
  } else {
    logger.info(
      { checked: report.checked, reconciled: report.reconciled },
      'Royalty reconciliation passed',
    );
  }

  return report;
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async () => {
      const report = await runRoyaltyReconciliationJob();
      const { armed, reasons } = evaluatePayoutEnablement(report);

      logger.info({ report, armed, reasons }, 'Royalty reconciliation finished');

      // A failing pass must not look like a clean one to cron: this exit code
      // is the gate #919 asks for.
      if (!report.passed) process.exitCode = 1;
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      logger.error({ err: error }, 'Royalty reconciliation job failed');
      process.exit(1);
    });
}
