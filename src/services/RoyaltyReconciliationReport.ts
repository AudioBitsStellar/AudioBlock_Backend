import type { RoyaltyReconciliationResult } from './RoyaltyPayoutService';
import type { RoyaltyReconciliationDiscrepancy, RoyaltyReconciliationReport } from '../types';

/**
 * Flatten a reconciliation result into recipient-level counts (Issue #919).
 *
 * `reconcilePendingPayouts` already wrote the comparison onto each payout's
 * `expectedSplits`; this reads it back so a caller can decide whether the pass
 * passed without re-deriving the rule ("every split's actual equals its
 * expected") in a second place.
 */
export function toRoyaltyReconciliationReport(
  result: RoyaltyReconciliationResult,
  ranAt: Date = new Date(),
): RoyaltyReconciliationReport {
  const discrepancies: RoyaltyReconciliationDiscrepancy[] = [];

  for (const payout of result.discrepancies) {
    for (const split of payout.expectedSplits) {
      if (split.actualAmount === split.expectedAmount) continue;
      discrepancies.push({
        saleEventId: payout.saleEventId,
        recipientPublicKey: split.recipientPublicKey,
        expectedAmount: split.expectedAmount,
        actualAmount: split.actualAmount ?? null,
      });
    }
  }

  return {
    ranAt: ranAt.toISOString(),
    checked: result.reconciled.length + result.discrepancies.length,
    reconciled: result.reconciled.length,
    discrepancies,
    passed: discrepancies.length === 0,
  };
}
