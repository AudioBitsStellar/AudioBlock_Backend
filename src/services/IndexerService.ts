/**
 * Indexer service for tracking blockchain event processing state and metrics.
 * Manages cursor positions, lag calculation, and health reporting (Issues #241, #253).
 */
import AppDataSource from '../config/db';
import { IndexerCursor } from '../entities/IndexerCursor';
import { BackfillStatus } from '../entities/BackfillStatus';
import {
  indexerLagLedgers,
  indexerEventsProcessedTotal,
  indexerErrorsTotal,
} from './MetricsService';
import logger from '../config/logger';

export interface IndexerStatus {
  contractId: string;
  network: string;
  lastProcessedLedger: number;
  eventsProcessed: number;
  errorCount: number;
  lastError: string | null;
  lastErrorAt: Date | null;
  lagLedgers: number;
  updatedAt: Date;
}

export interface BackfillInfo {
  contractId: string;
  network: string;
  completed: boolean;
  startLedger: number | null;
  endLedger: number | null;
  eventsImported: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class IndexerService {
  private get cursorRepo() {
    return AppDataSource.getRepository(IndexerCursor);
  }

  private get backfillRepo() {
    return AppDataSource.getRepository(BackfillStatus);
  }

  /**
   * Get or create an indexer cursor for a contract + network pair.
   */
  async getCursor(contractId: string, network: string): Promise<IndexerCursor> {
    let cursor = await this.cursorRepo.findOne({
      where: { contractId, network },
    });

    if (!cursor) {
      cursor = this.cursorRepo.create({
        contractId,
        network,
        lastProcessedLedger: 0,
        eventsProcessed: 0,
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
      });
      await this.cursorRepo.save(cursor);
    }

    return cursor;
  }

  /**
   * Record progress for an indexer after successfully processing a ledger.
   */
  async recordProgress(
    contractId: string,
    network: string,
    ledger: number,
    eventCount = 1,
  ): Promise<void> {
    const cursor = await this.getCursor(contractId, network);
    cursor.lastProcessedLedger = ledger;
    cursor.eventsProcessed += eventCount;
    await this.cursorRepo.save(cursor);

    // Update Prometheus metrics
    indexerEventsProcessedTotal.inc({ network, contract: contractId }, eventCount);
  }

  /**
   * Record an indexer error and update metrics.
   */
  async recordError(contractId: string, network: string, error: Error): Promise<void> {
    const cursor = await this.getCursor(contractId, network);
    cursor.errorCount += 1;
    cursor.lastError = error.message;
    cursor.lastErrorAt = new Date();
    await this.cursorRepo.save(cursor);

    // Update Prometheus metrics
    indexerErrorsTotal.inc({ network, contract: contractId });
  }

  /**
   * Calculate and update lag metrics for all cursors.
   * Should be called periodically by a monitoring loop.
   */
  async updateLagMetrics(currentLedger: number): Promise<void> {
    const cursors = await this.cursorRepo.find();

    for (const cursor of cursors) {
      const lag = Math.max(0, currentLedger - cursor.lastProcessedLedger);
      indexerLagLedgers.set({ network: cursor.network, contract: cursor.contractId }, lag);
    }
  }

  /**
   * Get status for all indexers (admin endpoint, Issue #253).
   */
  async getAllStatus(currentLedger?: number): Promise<IndexerStatus[]> {
    const cursors = await this.cursorRepo.find();

    return cursors.map((cursor) => ({
      contractId: cursor.contractId,
      network: cursor.network,
      lastProcessedLedger: cursor.lastProcessedLedger,
      eventsProcessed: cursor.eventsProcessed,
      errorCount: cursor.errorCount,
      lastError: cursor.lastError,
      lastErrorAt: cursor.lastErrorAt,
      lagLedgers: currentLedger ? Math.max(0, currentLedger - cursor.lastProcessedLedger) : 0,
      updatedAt: cursor.updatedAt,
    }));
  }

  /**
   * Get status for a specific contract + network.
   */
  async getStatus(
    contractId: string,
    network: string,
    currentLedger?: number,
  ): Promise<IndexerStatus> {
    const cursor = await this.getCursor(contractId, network);

    return {
      contractId: cursor.contractId,
      network: cursor.network,
      lastProcessedLedger: cursor.lastProcessedLedger,
      eventsProcessed: cursor.eventsProcessed,
      errorCount: cursor.errorCount,
      lastError: cursor.lastError,
      lastErrorAt: cursor.lastErrorAt,
      lagLedgers: currentLedger ? Math.max(0, currentLedger - cursor.lastProcessedLedger) : 0,
      updatedAt: cursor.updatedAt,
    };
  }

  // ── Backfill management (Issue #250) ──────────────────────────────────────

  /**
   * Check if backfill has been completed for a contract + network.
   */
  async isBackfillCompleted(contractId: string, network: string): Promise<boolean> {
    const status = await this.backfillRepo.findOne({
      where: { contractId, network },
    });
    return status?.completed ?? false;
  }

  /**
   * Mark backfill as started.
   */
  async startBackfill(
    contractId: string,
    network: string,
    startLedger: number,
    endLedger: number,
  ): Promise<BackfillStatus> {
    const existing = await this.backfillRepo.findOne({
      where: { contractId, network },
    });

    if (existing?.completed) {
      throw new Error(
        `Backfill already completed for ${contractId} on ${network}. ` +
          'Delete the record manually if re-run is intentional.',
      );
    }

    const status = existing || this.backfillRepo.create({ contractId, network });
    status.startLedger = startLedger;
    status.endLedger = endLedger;
    status.completed = false;
    status.eventsImported = 0;
    status.errorMessage = null;

    await this.backfillRepo.save(status);
    logger.info({ contractId, network, startLedger, endLedger }, 'Backfill started');
    return status;
  }

  /**
   * Update backfill progress.
   */
  async updateBackfillProgress(
    contractId: string,
    network: string,
    eventsImported: number,
  ): Promise<void> {
    const status = await this.backfillRepo.findOne({
      where: { contractId, network },
    });

    if (status) {
      status.eventsImported = eventsImported;
      await this.backfillRepo.save(status);
    }
  }

  /**
   * Mark backfill as completed.
   */
  async completeBackfill(contractId: string, network: string): Promise<void> {
    const status = await this.backfillRepo.findOne({
      where: { contractId, network },
    });

    if (status) {
      status.completed = true;
      await this.backfillRepo.save(status);
      logger.info({ contractId, network }, 'Backfill completed');
    }
  }

  /**
   * Record backfill failure.
   */
  async failBackfill(contractId: string, network: string, error: Error): Promise<void> {
    const status = await this.backfillRepo.findOne({
      where: { contractId, network },
    });

    if (status) {
      status.errorMessage = error.message;
      await this.backfillRepo.save(status);
      logger.error({ contractId, network, error }, 'Backfill failed');
    }
  }

  /**
   * Get all backfill statuses (for admin visibility).
   */
  async getAllBackfillStatus(): Promise<BackfillInfo[]> {
    const statuses = await this.backfillRepo.find();
    return statuses.map((s) => ({
      contractId: s.contractId,
      network: s.network,
      completed: s.completed,
      startLedger: s.startLedger,
      endLedger: s.endLedger,
      eventsImported: s.eventsImported,
      errorMessage: s.errorMessage,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }
}
