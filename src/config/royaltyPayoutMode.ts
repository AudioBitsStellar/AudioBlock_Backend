/**
 * Royalty payout mode feature flag (Issue #919).
 *
 * AudioBlocks records expected royalty payouts in the backend and reconciles
 * them against the Soroban royalty contract, but settlement itself happens
 * on-chain — see `docs/LEGAL_REVIEW_OPEN_ITEMS.md`. There is therefore no
 * backend code path that moves funds today, which means a boolean "payouts on"
 * switch would gate nothing. The gate that *is* missing is the one the launch
 * review asks for: a recorded decision about whether the pipeline has been
 * verified end-to-end before anybody turns it on for real.
 *
 * | ROYALTY_PAYOUT_MODE | Dry-run report | Enablement gate |
 * | ------------------- | -------------- | --------------- |
 * | `disabled`          | refused        | never armed     |
 * | `dry-run`           | produced       | never armed     |
 * | `enabled`           | produced       | armed iff the latest reconciliation pass reported no discrepancies |
 *
 * Defaults to `dry-run` (fail-closed): an unset or misspelled variable can
 * never arm payouts, and the operator still gets the report they need to sign
 * off. `enabled` has to be written down deliberately.
 */

import type { RoyaltyPayoutMode, RoyaltyReconciliationReport } from '../types';

export type { RoyaltyPayoutMode };

const MODES: readonly RoyaltyPayoutMode[] = ['disabled', 'dry-run', 'enabled'];

/** The configured mode, normalised. Anything unrecognised fails to `dry-run`. */
export function getRoyaltyPayoutMode(): RoyaltyPayoutMode {
  const raw = (process.env.ROYALTY_PAYOUT_MODE || '').trim().toLowerCase();
  return (MODES as readonly string[]).includes(raw) ? (raw as RoyaltyPayoutMode) : 'dry-run';
}

/**
 * Whether the dry-run reporter is allowed to read the payout ledger at all.
 *
 * `disabled` is the operator's "make this deployment stop touching royalties"
 * setting, so the read path is refused too — a disabled deployment should not
 * be producing reports an on-call might mistake for a sign-off.
 */
export function isRoyaltyPayoutReportingAllowed(): boolean {
  return getRoyaltyPayoutMode() !== 'disabled';
}

/**
 * Whether the pipeline is armed for real payouts, and why not.
 *
 * `reasons` is empty exactly when `armed` is true, so a caller can print the
 * whole verdict without re-deriving it. Every refusal names the action that
 * would clear it, because the answer is always one of: set the flag, or run the
 * reconciliation job and read its report.
 *
 * @param reconciliation - The most recent reconciliation report, or null when
 *   the job has not been run since the process started.
 */
export function evaluatePayoutEnablement(
  reconciliation: RoyaltyReconciliationReport | null,
  mode: RoyaltyPayoutMode = getRoyaltyPayoutMode(),
): { armed: boolean; reasons: string[] } {
  if (mode === 'disabled') {
    return {
      armed: false,
      reasons: ['ROYALTY_PAYOUT_MODE=disabled — royalty processing is switched off.'],
    };
  }

  if (mode === 'dry-run') {
    return {
      armed: false,
      reasons: [
        'ROYALTY_PAYOUT_MODE=dry-run — payouts are reported, never armed. Set it to `enabled` to arm.',
      ],
    };
  }

  if (!reconciliation) {
    return {
      armed: false,
      reasons: [
        'ROYALTY_PAYOUT_MODE=enabled but no reconciliation report is available — run `npm run reconcile:royalties` and require it to pass.',
      ],
    };
  }

  if (!reconciliation.passed) {
    return {
      armed: false,
      reasons: [
        `Last royalty reconciliation (${reconciliation.ranAt}) did not pass: ${reconciliation.discrepancies.length} recipient-level discrepancy(ies).`,
      ],
    };
  }

  return { armed: true, reasons: [] };
}
