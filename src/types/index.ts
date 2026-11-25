export interface RoyaltyPayoutEvent {
  saleEventId: string;
  onChainEventId: string;
  recipientPublicKey: string;
  amountStroops: string;
}

/**
 * One recipient-level mismatch between what the ledger expected a sale to pay
 * and what the royalty contract actually paid (Issue #919).
 *
 * `actualAmount` is null when no on-chain payout landed for that recipient at
 * all, which is a different operator problem from "landed the wrong amount".
 */
export interface RoyaltyReconciliationDiscrepancy {
  saleEventId: string;
  recipientPublicKey: string;
  expectedAmount: string;
  actualAmount: string | null;
}

/**
 * Outcome of a single royalty reconciliation pass.
 *
 * This exists so that "the reconciliation job passed" is something a caller can
 * check instead of having to infer from a log line: `runRoyaltyReconciliationJob`
 * used to return `void`, so no sign-off gate could be built on top of it.
 */
export interface RoyaltyReconciliationReport {
  ranAt: string;
  /** Payout records examined in this pass. */
  checked: number;
  reconciled: number;
  discrepancies: RoyaltyReconciliationDiscrepancy[];
  /** True when the pass found nothing that disagrees with the ledger. */
  passed: boolean;
}

/** Switch settings for royalty payout processing, read from `ROYALTY_PAYOUT_MODE`. */
export type RoyaltyPayoutMode = 'disabled' | 'dry-run' | 'enabled';

/**
 * What a royalty payout batch would pay, computed without touching the database
 * (Issue #919). Emitted by the dry-run job so an operator can read the numbers
 * before arming real payouts.
 */
export interface RoyaltyPayoutDryRunReport {
  ranAt: string;
  mode: RoyaltyPayoutMode;
  /** Payout records that would have been reconsidered. */
  checked: number;
  wouldReconcile: number;
  wouldFlagDiscrepancy: number;
  discrepancies: RoyaltyReconciliationDiscrepancy[];
  /** Sum of `grossAmount` across `checked`, in stroops. */
  totalGrossStroops: string;
  /** Per-recipient totals the ledger claims are owed, in stroops. */
  expectedToPay: { recipientPublicKey: string; amountStroops: string }[];
  /** Payouts still held because the artist is not verified (#979). */
  heldCount: number;
  /** Always false: the dry run persists nothing. */
  written: false;
}
