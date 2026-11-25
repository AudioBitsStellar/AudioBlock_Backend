import { In } from 'typeorm';
import AppDataSource from '../config/db';
import { RoyaltyPayout, RoyaltyPayoutStatus } from '../entities/RoyaltyPayout';
import { SorobanContracts } from '../config/soroban';
import { SorobanService } from './Soroban/SorobanService';
import { getRoyaltyPayoutMode } from '../config/royaltyPayoutMode';
import type {
  RoyaltyPayoutDryRunReport,
  RoyaltyPayoutEvent,
  RoyaltyPayoutMode,
  RoyaltyReconciliationDiscrepancy,
} from '../types';

/**
 * The subset of a payout record the dry run reads. Declared structurally so the
 * report builder can be exercised with plain objects instead of hydrated
 * entities.
 */
export interface DryRunPayout {
  saleEventId: string;
  grossAmount: string;
  status: RoyaltyPayoutStatus;
  heldUntilVerified: boolean;
  expectedSplits: { recipientPublicKey: string; expectedAmount: string }[];
}

/**
 * Sum of a list of stroop amounts held as strings (BigInt, never float — the
 * amounts are money).
 */
function sumStroops(values: Iterable<string>): string {
  let total = 0n;
  for (const value of values) total += BigInt(value);
  return total.toString();
}

/**
 * On-chain payout amounts keyed by the sale event and recipient they settle.
 *
 * `\u0000` separates the two parts because both are opaque strings, and any
 * separator that could appear inside one of them would key ambiguously.
 */
function indexPayoutEvents(events: readonly RoyaltyPayoutEvent[]): Map<string, string> {
  const bySaleAndRecipient = new Map<string, string>();
  for (const event of events) {
    bySaleAndRecipient.set(
      `${event.saleEventId}\u0000${event.recipientPublicKey}`,
      event.amountStroops,
    );
  }
  return bySaleAndRecipient;
}

/**
 * Compare one payout's expected splits against the on-chain index.
 *
 * @returns the recipient-level mismatches, and whether the whole payout would
 *   reconcile — the same two outcomes `reconcileEvents` records as
 *   `reconciled` vs `discrepancy`.
 */
function comparePayout(
  payout: DryRunPayout,
  actualBySaleAndRecipient: ReadonlyMap<string, string>,
): { discrepancies: RoyaltyReconciliationDiscrepancy[]; clean: boolean } {
  const discrepancies: RoyaltyReconciliationDiscrepancy[] = [];

  for (const split of payout.expectedSplits) {
    const actual = actualBySaleAndRecipient.get(
      `${payout.saleEventId}\u0000${split.recipientPublicKey}`,
    );
    if (actual === split.expectedAmount) continue;
    discrepancies.push({
      saleEventId: payout.saleEventId,
      recipientPublicKey: split.recipientPublicKey,
      expectedAmount: split.expectedAmount,
      actualAmount: actual ?? null,
    });
  }

  return { discrepancies, clean: discrepancies.length === 0 };
}

/** Expected amounts each recipient is owed, grouped for the per-recipient total. */
function groupExpectedAmountsByRecipient(payouts: readonly DryRunPayout[]): Map<string, string[]> {
  const byRecipient = new Map<string, string[]>();
  for (const payout of payouts) {
    for (const split of payout.expectedSplits) {
      const bucket = byRecipient.get(split.recipientPublicKey);
      if (bucket) bucket.push(split.expectedAmount);
      else byRecipient.set(split.recipientPublicKey, [split.expectedAmount]);
    }
  }
  return byRecipient;
}

/**
 * Compute what a reconciliation pass *would* write, without writing anything.
 *
 * Mirrors `RoyaltyPayoutService.reconcileEvents` comparison logic — expected
 * split amount vs the on-chain payout event for that recipient — but reads
 * instead of mutating, so an operator can review the numbers before the ledger
 * is updated (Issue #919).
 */
export function buildRoyaltyPayoutDryRunReport(
  payouts: readonly DryRunPayout[],
  events: readonly RoyaltyPayoutEvent[],
  mode: RoyaltyPayoutMode = getRoyaltyPayoutMode(),
  ranAt: Date = new Date(),
): RoyaltyPayoutDryRunReport {
  const actualBySaleAndRecipient = indexPayoutEvents(events);

  const discrepancies: RoyaltyReconciliationDiscrepancy[] = [];
  let wouldReconcile = 0;
  let wouldFlagDiscrepancy = 0;

  for (const payout of payouts) {
    const compared = comparePayout(payout, actualBySaleAndRecipient);
    discrepancies.push(...compared.discrepancies);
    if (compared.clean) wouldReconcile += 1;
    else wouldFlagDiscrepancy += 1;
  }

  return {
    ranAt: ranAt.toISOString(),
    mode,
    checked: payouts.length,
    wouldReconcile,
    wouldFlagDiscrepancy,
    discrepancies,
    totalGrossStroops: sumStroops(payouts.map((p) => p.grossAmount)),
    expectedToPay: [...groupExpectedAmountsByRecipient(payouts).entries()]
      .map(([recipientPublicKey, amounts]) => ({
        recipientPublicKey,
        amountStroops: sumStroops(amounts),
      }))
      .sort((a, b) => a.recipientPublicKey.localeCompare(b.recipientPublicKey)),
    heldCount: payouts.filter((p) => p.heldUntilVerified).length,
    written: false,
  };
}

/**
 * Reads the royalty ledger and produces the #919 dry-run report.
 *
 * This service is deliberately incapable of writing: it holds no `save`,
 * `update` or `delete` call, so "the dry run changed nothing" is a property of
 * the type rather than a promise in a doc comment.
 */
export class RoyaltyPayoutDryRunService {
  private royaltyPayoutRepo = AppDataSource.getRepository(RoyaltyPayout);
  private soroban = new SorobanService();

  /**
   * @returns A report over the payouts a real reconciliation pass would touch
   *   now — the same `pending` + `discrepancy` set `reconcilePendingPayouts`
   *   selects.
   */
  async generateReport(): Promise<RoyaltyPayoutDryRunReport> {
    const payouts = await this.royaltyPayoutRepo.findBy({
      status: In([RoyaltyPayoutStatus.PENDING, RoyaltyPayoutStatus.DISCREPANCY]),
    });

    const events = await this.soroban.getRoyaltyPayoutEvents(
      SorobanContracts.royalty,
      payouts.map((payout) => payout.saleEventId),
    );

    return buildRoyaltyPayoutDryRunReport(payouts, events);
  }
}
