/**
 * Indexer worker: polls Soroban contract events and persists them.
 *
 * Built around the `getEvents` cursor API (Issue #233) and generalized to poll
 * all configured contracts concurrently — NFT, Artist, Catalog, Royalty and
 * Marketplace (Issue #234).
 *
 * Key behaviours:
 *  - Polls each contract on a configurable interval (`INDEXER_POLL_INTERVAL_MS`).
 *  - Persists the cursor after each successful batch (via IndexerService).
 *  - Uses the reorg guard to roll back on gaps / reorgs.
 *  - A failure in one contract never blocks the others.
 *  - Idempotent persistence via IndexedEventService.upsertEvent.
 *  - Periodically refreshes the lag metric (Issue #240).
 */
import { SorobanEventReader, EventsPage } from '../../services/Soroban/SorobanEventReader';
import { IndexerReorgGuard } from '../../services/Soroban/IndexerReorgGuard';
import { IndexerService } from '../../services/IndexerService';
import { IndexedEventService } from '../../services/IndexedEventService';
import {
  buildIndexerContracts,
  IndexerContract,
} from '../../services/Soroban/IndexerContractRegistry';
import { getSorobanNetwork } from '../../config/soroban';
import logger from '../../config/logger';

const DEFAULT_POLL_INTERVAL_MS = parseInt(process.env.INDEXER_POLL_INTERVAL_MS || '15000', 10);
const EVENTS_PER_PAGE = parseInt(process.env.INDEXER_PAGE_SIZE || '200', 10);
const LAG_MONITOR_INTERVAL_MS = parseInt(
  process.env.INDEXER_LAG_MONITOR_INTERVAL_MS || '15000',
  10,
);

export interface PollConfig {
  pollIntervalMs?: number;
  pageSize?: number;
  lagMonitorIntervalMs?: number;
}

export interface PollOutcome {
  contractType: string;
  eventsFetched: number;
  eventsProcessed: number;
  errors: number;
  cursor: string | null;
  latestLedger: number;
}

export class IndexerWorker {
  private indexerService: IndexerService;
  private eventService: IndexedEventService;
  private reader: SorobanEventReader;
  private network: string;
  private contracts: IndexerContract[];
  private guards: Map<string, IndexerReorgGuard> = new Map();
  private pollIntervalMs: number;
  private pageSize: number;
  private lagMonitorIntervalMs: number;
  private stopped = false;

  constructor(
    options: {
      contracts?: IndexerContract[];
      indexerService?: IndexerService;
      eventService?: IndexedEventService;
      reader?: SorobanEventReader;
      pollConfig?: PollConfig;
    } = {},
  ) {
    this.indexerService = options.indexerService ?? new IndexerService();
    this.eventService = options.eventService ?? new IndexedEventService();
    this.reader = options.reader ?? new SorobanEventReader();
    this.network = getSorobanNetwork();
    this.contracts = options.contracts ?? buildIndexerContracts();
    this.pollIntervalMs = options.pollConfig?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pageSize = options.pollConfig?.pageSize ?? EVENTS_PER_PAGE;
    this.lagMonitorIntervalMs = options.pollConfig?.lagMonitorIntervalMs ?? LAG_MONITOR_INTERVAL_MS;

    for (const contract of this.contracts) {
      this.guards.set(contract.contractType, new IndexerReorgGuard());
    }
  }

  private guardFor(type: string): IndexerReorgGuard {
    return this.guards.get(type) ?? new IndexerReorgGuard();
  }

  /**
   * Run a single poll cycle for one contract and return the outcome.
   */
  async pollOnce(contract: IndexerContract): Promise<PollOutcome> {
    let eventsFetched = 0;
    let eventsProcessed = 0;
    let errors = 0;
    let cursor: string | null = null;

    try {
      const stored = await this.indexerService.getCursor(contract.contractId, this.network);
      const guard = this.guardFor(contract.contractType);
      guard.setCursor(stored.lastProcessedLedger);

      // Resolve the current tip so the reorg guard can compute overlap.
      const latestLedger = await this.reader.getLatestLedger();
      const start = guard.getOverlapStart(latestLedger);

      const initial = await this.pollInitialPage(
        contract,
        start,
        latestLedger,
        stored.lastProcessedLedger,
      );
      eventsFetched += initial.fetched;
      eventsProcessed += initial.processed;
      errors += initial.errors;
      cursor = initial.cursor;

      const drained = await this.drainPages(
        contract,
        initial.cursor ?? undefined,
        stored.lastProcessedLedger,
      );
      eventsFetched += drained.fetched;
      eventsProcessed += drained.processed;
      errors += drained.errors;
      cursor = drained.cursor || cursor;

      return {
        contractType: contract.contractType,
        eventsFetched,
        eventsProcessed,
        errors,
        cursor,
        latestLedger,
      };
    } catch (err) {
      errors += 1;
      await this.indexerService
        .recordError(contract.contractId, this.network, err as Error)
        .catch(() => undefined);
      logger.error({ contract: contract.contractType, err }, 'Indexer poll cycle failed');
      return {
        contractType: contract.contractType,
        eventsFetched,
        eventsProcessed,
        errors,
        cursor,
        latestLedger: 0,
      };
    }
  }

  /**
   * Fetch the first page for a ledger range and persist it. Returns the cursor
   * to continue paging from ('' when there is none).
   */
  private async pollInitialPage(
    contract: IndexerContract,
    start: number | null,
    latestLedger: number,
    prevLedger: number,
  ): Promise<{ fetched: number; processed: number; errors: number; cursor: string | null }> {
    if (start === null) {
      return { fetched: 0, processed: 0, errors: 0, cursor: null };
    }

    const first = await this.reader.fetchEvents({
      contractIds: [contract.contractId],
      startLedger: start,
      endLedger: latestLedger,
      limit: this.pageSize,
    });
    const outcome = await this.persistProgress(contract, first, prevLedger);
    return {
      fetched: first.events.length,
      processed: outcome.processed,
      errors: outcome.errors,
      cursor: first.cursor || null,
    };
  }

  /**
   * Drain remaining events via cursor pagination until caught up.
   */
  private async drainPages(
    contract: IndexerContract,
    startCursor: string | undefined,
    prevLedger: number,
  ): Promise<{ fetched: number; processed: number; errors: number; cursor: string | null }> {
    let fetched = 0;
    let processed = 0;
    let errors = 0;
    let cursor: string | null = null;
    const seenCursors = new Set<string>();

    let pageCursor = startCursor;
    while (pageCursor && !this.stopped) {
      if (seenCursors.has(pageCursor)) break;
      seenCursors.add(pageCursor);

      const page = await this.reader.fetchEvents({
        contractIds: [contract.contractId],
        cursor: pageCursor,
        limit: this.pageSize,
      });
      const outcome = await this.persistProgress(contract, page, prevLedger);
      fetched += page.events.length;
      processed += outcome.processed;
      errors += outcome.errors;
      cursor = page.cursor || cursor;
      pageCursor = page.cursor || undefined;
    }

    return { fetched, processed, errors, cursor };
  }

  private async persistProgress(
    contract: IndexerContract,
    page: EventsPage,
    prevLedger: number,
  ): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;

    for (const event of page.events) {
      const dto = contract.decoder.decode(event);
      if (!dto) continue;
      try {
        await this.eventService.upsertEvent(dto);
        processed += 1;
      } catch (err) {
        errors += 1;
        logger.error(
          { contract: contract.contractType, eventId: event.id, err },
          'Failed to persist indexed event',
        );
      }
    }

    const highestLedger = page.events.reduce((max, ev) => Math.max(max, ev.ledger), prevLedger);
    if (processed > 0 || highestLedger > prevLedger) {
      await this.indexerService.recordProgress(
        contract.contractId,
        this.network,
        highestLedger,
        processed,
      );
      this.guardFor(contract.contractType).updateCursor(highestLedger);
    }

    return { processed, errors };
  }

  /**
   * Refresh the lag gauge for every known cursor (Issue #240).
   */
  async updateLagMetrics(): Promise<void> {
    const latestLedger = await this.reader.getLatestLedger().catch(() => 0);
    if (latestLedger <= 0) return;
    await this.indexerService.updateLagMetrics(latestLedger);
  }

  /**
   * Start polling all contracts concurrently. Resolves immediately; polls run
   * until `stop()` is called.
   */
  start(): void {
    logger.info(
      { contracts: this.contracts.map((c) => c.contractType), intervalMs: this.pollIntervalMs },
      'Starting indexer worker',
    );

    for (const contract of this.contracts) {
      setInterval(() => {
        void this.runSafely(contract);
      }, this.pollIntervalMs);
    }

    // Kick off an initial pass for each contract, then let the timers drive.
    for (const contract of this.contracts) {
      void this.runSafely(contract);
    }

    setInterval(() => {
      void this.updateLagMetrics().catch((err) =>
        logger.error({ err }, 'Indexer lag metric update failed'),
      );
    }, this.lagMonitorIntervalMs);
  }

  /**
   * Run a single poll cycle, swallowing errors so one contract never blocks
   * the others (Issue #234).
   */
  private async runSafely(contract: IndexerContract): Promise<void> {
    try {
      const outcome = await this.pollOnce(contract);
      logger.info(
        {
          contract: contract.contractType,
          ...outcome,
        },
        'Indexer poll cycle complete',
      );
    } catch (err) {
      logger.error({ contract: contract.contractType, err }, 'Indexer poll cycle crashed');
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
