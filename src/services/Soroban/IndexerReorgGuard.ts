import logger from '../../config/logger';

/**
 * Configuration for the reorg guard.
 * All values can be overridden via environment variables.
 */
export interface ReorgGuardConfig {
  /** How many ledgers back to overlap on each poll to catch late reorgs. */
  overlapWindow: number;
  /** Maximum number of missing ledgers before we treat it as a gap. */
  gapThreshold: number;
}

const DEFAULT_CONFIG: ReorgGuardConfig = {
  overlapWindow: parseInt(process.env.INDEXER_OVERLAP_WINDOW || '10', 10),
  gapThreshold: parseInt(process.env.INDEXER_GAP_THRESHOLD || '5', 10),
};

/**
 * Tracks the indexer's cursor (last processed ledger) and detects
 * gaps or ledger reorgs between successive polls.
 *
 * Usage:
 *   const guard = new IndexerReorgGuard(config);
 *   // On each poll cycle:
 *   const overlap = guard.getOverlapStart(latestAvailableLedger);
 *   // ... fetch events from overlap to latestAvailableLedger ...
 *   guard.updateCursor(processedLedger);
 */
export class IndexerReorgGuard {
  private cursor: number | null = null;
  private config: ReorgGuardConfig;

  constructor(config?: Partial<ReorgGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Set or update the cursor externally (e.g. from database). */
  setCursor(ledger: number): void {
    this.cursor = ledger;
  }

  /** Get the current cursor value. */
  getCursor(): number | null {
    return this.cursor;
  }

  /**
   * Given the RPC's latest available ledger, returns the ledger number
   * from which to start fetching events. This accounts for:
   * - Initial state (no cursor yet)
   * - Normal progression (cursor + 1)
   * - Gap detection (rolls back by overlapWindow if gap exceeds threshold)
   * - Reorg detection (rolls back by overlapWindow if RPC ledger < cursor)
   *
   * Returns null if the RPC has no data beyond our cursor (nothing to fetch).
   */
  getOverlapStart(latestAvailableLedger: number): number | null {
    if (this.cursor === null) {
      // First run — start from latest minus overlap to catch recent events
      return Math.max(1, latestAvailableLedger - this.config.overlapWindow);
    }

    const expectedNext = this.cursor + 1;

    if (latestAvailableLedger < this.cursor) {
      // Reorg: RPC is behind our cursor. Roll back to catch up.
      logger.warn(
        { cursor: this.cursor, latestAvailableLedger },
        'Ledger reorg detected: RPC ledger is behind cursor, rolling back',
      );
      const rollback = Math.max(1, this.cursor - this.config.overlapWindow);
      return rollback;
    }

    if (latestAvailableLedger === this.cursor) {
      // No new ledgers
      return null;
    }

    const gap = latestAvailableLedger - this.cursor;

    if (gap > this.config.gapThreshold) {
      // Large gap detected — likely missed ledgers. Roll back for safety.
      logger.warn(
        { cursor: this.cursor, latestAvailableLedger, gap },
        'Large ledger gap detected, rolling back to overlap window',
      );
      const rollback = Math.max(1, this.cursor - this.config.overlapWindow);
      return rollback;
    }

    // Normal case: start from expected next ledger
    return expectedNext;
  }

  /**
   * Update the cursor after successfully processing events up to
   * the given ledger number.
   */
  updateCursor(processedLedger: number): void {
    if (this.cursor === null || processedLedger > this.cursor) {
      this.cursor = processedLedger;
    }
  }
}
