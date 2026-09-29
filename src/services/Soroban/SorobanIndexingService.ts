/**
 * SorobanIndexingService: Coordinates real-time indexing of Soroban contract events
 * into the `indexed_events` table (Issue #658 – Implement indexing for Soroban
 * contract events).
 *
 * Responsibilities:
 *  1. Polls the Soroban RPC for new events since the last processed ledger.
 *  2. Routes each event to the appropriate per-contract-type decoder.
 *  3. Persists decoded rows via IndexedEventService.
 *  4. Advances the cursor so progress survives restarts.
 *  5. Emits Prometheus metrics for lag and processing rate.
 *
 * Architecture note:
 *  The service is intentionally stateless beyond its cursor repository. The
 *  IndexerWorker drives it from the outside (start / stop lifecycle). Each
 *  contract type runs through the same code path, using the decoder registry
 *  keyed by ContractType from eventDecoders.ts.
 */

import { buildIndexerContracts } from './IndexerContractRegistry';
import { SorobanEventReader } from './SorobanEventReader';
import { IndexerService } from '../IndexerService';
import { IndexedEventService } from '../IndexedEventService';
import {
  indexerLagLedgers,
  indexerEventsProcessedTotal,
  indexerErrorsTotal,
} from '../MetricsService';
import logger from '../../config/logger';

export interface SorobanIndexingServiceOptions {
  /** Number of ledgers to fetch per RPC page. Defaults to 200. */
  pageSize?: number;
  /** Networks to index, e.g. ['testnet', 'mainnet']. Defaults to ['testnet']. */
  networks?: string[];
}

export class SorobanIndexingService {
  private reader: SorobanEventReader;
  private indexerService: IndexerService;
  private eventService: IndexedEventService;
  private pageSize: number;
  private networks: string[];

  constructor(
    reader: SorobanEventReader,
    indexerService: IndexerService,
    eventService: IndexedEventService,
    options: SorobanIndexingServiceOptions = {},
  ) {
    this.reader = reader;
    this.indexerService = indexerService;
    this.eventService = eventService;
    this.pageSize = options.pageSize ?? 200;
    this.networks = options.networks ?? ['testnet'];
  }

  /**
   * Process one indexing cycle for all registered contracts on all configured
   * networks. Called repeatedly by the IndexerWorker on a configurable interval.
   *
   * Returns the total number of events persisted in this cycle.
   */
  async processNextBatch(): Promise<number> {
    let totalPersisted = 0;

    for (const network of this.networks) {
      const contracts = buildIndexerContracts();

      for (const contract of contracts) {
        const { contractType, contractId, decoder } = contract;
        const label = `${contractType}@${network}`;

        try {
          // Retrieve or initialise the cursor for this contract+network pair.
          const cursor = await this.indexerService.getCursor(contractId, network);
          const fromLedger = cursor.lastProcessedLedger + 1;

          // Fetch one page of events starting from the persisted ledger.
          const page = await this.reader.fetchEvents({
            contractIds: [contractId],
            startLedger: fromLedger,
            limit: this.pageSize,
          });

          // Update the lag gauge regardless of whether any events were found.
          const lag = Math.max(0, page.latestLedger - (cursor.lastProcessedLedger || fromLedger));
          indexerLagLedgers.set({ contract: contractId, network }, lag);

          if (page.events.length === 0) {
            logger.debug({ label, fromLedger, latestLedger: page.latestLedger }, 'No new events');
            continue;
          }

          // Decode and collect insertable rows.
          const rows = [];
          for (const event of page.events) {
            const dto = decoder.decode(event);
            if (dto) {
              rows.push(dto);
            }
          }

          // Persist in a single batch.
          if (rows.length > 0) {
            await this.eventService.insertBatch(rows);
            indexerEventsProcessedTotal.inc({ contract: contractId, network }, rows.length);
            totalPersisted += rows.length;
          }

          // Advance the cursor to the highest ledger seen in this page.
          const maxLedger = page.events.reduce((m, e) => Math.max(m, e.ledger), fromLedger);
          await this.indexerService.advanceCursor(contractId, network, maxLedger);

          logger.info(
            { label, decoded: rows.length, maxLedger, lag },
            'Soroban indexing batch complete',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ label, err: message }, 'Soroban indexing batch failed');
          indexerErrorsTotal.inc({ contract: contractId, network });

          // Record error in cursor so health endpoint can surface it.
          await this.indexerService.recordError(contractId, network, message).catch(() => {});
        }
      }
    }

    return totalPersisted;
  }
}
