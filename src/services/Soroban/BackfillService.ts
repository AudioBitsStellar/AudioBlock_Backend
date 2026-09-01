/**
 * Historical backfill for the indexer (Issue #235).
 *
 * Walks `getEvents` from a contract's deployment ledger to the current tip in
 * batches and writes to the same `indexed_events` table the live poller uses.
 *
 * Properties:
 *  - Idempotent: rows are upserted with a unique (network, contractId, ledger,
 *    eventId) constraint, so re-running never duplicates.
 *  - Resumable: progress is checkpointed to `indexer_cursors` after each batch.
 *  - Guarded by a `backfill_status` completion marker to avoid accidental
 *    re-execution (and safe to re-run after clearing the marker).
 */
import { SorobanEventReader, EventsPage } from './SorobanEventReader';
import { IndexerService } from '../IndexerService';
import { IndexedEventService } from '../IndexedEventService';
import { EVENT_DECODERS, ContractType, SorobanEventDecoder } from './eventDecoders';
import logger from '../../config/logger';

export interface BackfillOptions {
  contractId: string;
  contractType: ContractType;
  network: string;
  startLedger: number;
  endLedger: number;
  batchSize?: number;
}

interface BackfillRunState {
  imported: number;
  currentLedger: number;
}

export interface BackfillProgress {
  contractId: string;
  network: string;
  startLedger: number;
  endLedger: number;
  eventsImported: number;
  currentLedger: number;
}

export class BackfillService {
  private reader: SorobanEventReader;
  private indexerService: IndexerService;
  private eventService: IndexedEventService;

  constructor(
    options: {
      reader?: SorobanEventReader;
      indexerService?: IndexerService;
      eventService?: IndexedEventService;
    } = {},
  ) {
    this.reader = options.reader ?? new SorobanEventReader();
    this.indexerService = options.indexerService ?? new IndexerService();
    this.eventService = options.eventService ?? new IndexedEventService();
  }

  /**
   * Run a backfill for one contract + network pair.
   *
   * Refuses to run when a completion marker already exists. Otherwise resumes
   * from the last checkpoint in `indexer_cursors`.
   */
  async run(opts: BackfillOptions): Promise<BackfillProgress> {
    const decoder = EVENT_DECODERS[opts.contractType];
    const batchSize = opts.batchSize ?? 200;

    await this.assertNotCompleted(opts);

    const cursor = await this.indexerService.getCursor(opts.contractId, opts.network);
    const resumeFrom = Math.max(opts.startLedger, cursor.lastProcessedLedger + 1);

    logger.info(
      {
        contractId: opts.contractId,
        network: opts.network,
        startLedger: resumeFrom,
        endLedger: opts.endLedger,
        batchSize,
      },
      'Backfill started',
    );

    const state: BackfillRunState = {
      imported: 0,
      currentLedger: resumeFrom - 1,
    };

    await this.reader.fetchAllInRange(
      [opts.contractId],
      resumeFrom,
      opts.endLedger,
      batchSize,
      (page, nextStart) => this.processBatch(opts, decoder, state, page, nextStart),
    );

    return this.finalize(opts, state, resumeFrom);
  }

  /**
   * Mark the backfill as completed, log, and return the summary.
   */
  private async finalize(
    opts: BackfillOptions,
    state: BackfillRunState,
    resumeFrom: number,
  ): Promise<BackfillProgress> {
    await this.indexerService.completeBackfill(opts.contractId, opts.network);
    logger.info(
      { contractId: opts.contractId, network: opts.network, imported: state.imported },
      'Backfill complete',
    );

    return {
      contractId: opts.contractId,
      network: opts.network,
      startLedger: resumeFrom,
      endLedger: opts.endLedger,
      eventsImported: state.imported,
      currentLedger: state.currentLedger,
    };
  }

  /**
   * Throw if a completion marker already exists for this contract + network.
   */
  private async assertNotCompleted(opts: BackfillOptions): Promise<void> {
    if (await this.indexerService.isBackfillCompleted(opts.contractId, opts.network)) {
      throw new Error(
        `Backfill already completed for ${opts.contractId} on ${opts.network}. ` +
          'Delete the backfill_status record manually if a re-run is intentional.',
      );
    }
  }

  /**
   * Persist one batch of events and checkpoint progress.
   */
  private async processBatch(
    opts: BackfillOptions,
    decoder: SorobanEventDecoder,
    state: BackfillRunState,
    page: EventsPage,
    nextStart: number,
  ): Promise<void> {
    let batchImported = 0;
    for (const event of page.events) {
      const dto = decoder.decode(event);
      if (!dto) continue;
      try {
        await this.eventService.upsertEvent(dto);
        batchImported += 1;
      } catch (err) {
        logger.error(
          { contractId: opts.contractId, eventId: event.id, err },
          'Backfill failed to persist event',
        );
      }
    }

    state.imported += batchImported;
    const highestLedger = page.events.reduce(
      (max, ev) => Math.max(max, ev.ledger),
      state.currentLedger,
    );
    state.currentLedger = Math.max(state.currentLedger, highestLedger);

    await this.indexerService.recordProgress(
      opts.contractId,
      opts.network,
      Math.max(state.currentLedger, nextStart - 1),
      batchImported,
    );
    await this.indexerService.updateBackfillProgress(opts.contractId, opts.network, state.imported);

    logger.info(
      {
        batchLedger: state.currentLedger,
        batchImported,
        totalImported: state.imported,
        nextStart,
      },
      'Backfill batch complete',
    );
  }

  /** Get current backfill status for a contract + network (safe to call). */
  async status(
    contractId: string,
    network: string,
  ): Promise<{
    completed: boolean;
    startLedger: number | null;
    endLedger: number | null;
    eventsImported: number;
    errorMessage: string | null;
    cursorLedger: number | null;
  } | null> {
    const [backfill, cursor] = await Promise.all([
      this.indexerService.getBackfillStatus(contractId, network),
      this.indexerService.getCursor(contractId, network).catch(() => null),
    ]);

    if (!backfill) return null;

    return {
      completed: backfill.completed,
      startLedger: backfill.startLedger,
      endLedger: backfill.endLedger,
      eventsImported: backfill.eventsImported,
      errorMessage: backfill.errorMessage,
      cursorLedger: cursor?.lastProcessedLedger ?? null,
    };
  }
}
