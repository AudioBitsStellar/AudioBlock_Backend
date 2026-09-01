/**
 * Blockchain event indexer worker (Issues #255, #258)
 *
 * Polls Soroban RPC for contract events from AudioBlock's 5 facets:
 * - ArtistFacet: Artist registration and profile updates
 * - SongFacet: Song minting and metadata
 * - AlbumFacet: Album creation
 * - MarketplaceFacet: Listings and sales
 * - RoyaltyFacet: Royalty distributions
 *
 * Features:
 * - Multi-network support (concurrent mainnet + testnet)
 * - Graceful shutdown (SIGTERM/SIGINT)
 * - Network isolation (failures don't affect other networks)
 * - Resumable from cursor position
 */

import { IndexerService } from '../services/IndexerService';
import { IndexedEventService, InsertIndexedEventDTO } from '../services/IndexedEventService';
import logger from '../config/logger';

// Poll interval in milliseconds
const POLL_INTERVAL_MS = parseInt(process.env.INDEXER_POLL_INTERVAL_MS || '5000', 10);

// Batch size for event processing
const BATCH_SIZE = parseInt(process.env.INDEXER_BATCH_SIZE || '100', 10);

// Overlap window for reorg protection
const OVERLAP_WINDOW = parseInt(process.env.INDEXER_OVERLAP_WINDOW || '10', 1
t'
        ? process.env.SOROBAN_RPC_URL_MAINNET || 'https://soroban-mainnet.stellar.org'
        : process.env.SOROBAN_RPC_URL_TESTNET || 'https://soroban-testnet.stellar.org';
  }

  /**
   * Fetch events from a contract starting at a specific ledger
   */
  async getEvents(
    contractId: string,
    startLedger: number,
    endLedger: number,
  ): Promise<SorobanEvent[]> {
    // TODO: Implement actual RPC call using @stellar/stellar-sdk
    // For now, return empty array to allow testing of the worker structure
    logger.debug(
      { contractId, startLedger, endLedger, rpcUrl: this.rpcUrl },
      'Fetching events from Soroban RPC',
    );
    return [];
  }

  /**
   * Get the latest ledger number from the network
   */
  async getLatestLedger(): Promise<number> {
    // TODO: Implement actual RPC call
    // For now, return a mock value
    return 1000000;
  }
}

/**
 * Main indexer worker class
 */
export class IndexerWorker {
  private indexerService: IndexerService;
  private eventService: IndexedEventService;
  private shutdownRequested = false;
  private activePollers = 0;
  private contracts: ContractConfig[] = [];

  constructor() {
    this.indexerService = new IndexerService();
    this.eventService = new IndexedEventService();
    this.loadContractConfigs();
  }

  /**
   * Load contract configurations from environment variables
   */
  private loadContractConfigs(): void {
    const contractTypes = ['ARTIST_FACET', 'SONG_FACET', 'ALBUM_FACET', 'MARKETPLACE_FACET', 'ROYALTY_FACET'];
    const networks = ['MAINNET', 'TESTNET'];

    for (const contractType of contractTypes) {
      for (const network of networks) {
        const envKey = `${contractType}_${network}_CONTRACT_ID`;
        const contractId = process.env[envKey];

        if (contractId) {
          this.contracts.push({
            contractId,
            network: network.toLowerCase(),
            name: contractType.toLowerCase().replace('_', '-'),
          });
          logger.info(
            { contractType, network: network.toLowerCase(), contractId },
            'Loaded contract configuration',
          );
        }
      }
    }

    if (this.contracts.length === 0) {
      logger.warn('No contract configurations found in environment variables');
      logger.warn('Set CONTRACT_ID environment variables to enable indexing');
    }
  }

  /**
   * Setup signal handlers for graceful shutdown (Issue #258)
   */
  private setupShutdownHandlers(): void {
    const handleShutdown = (signal: string) => {
      logger.info({ signal }, 'Shutdown signal received, finishing current batches...');
      this.shutdownRequested = true;
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }

  /**
   * Poll events for a single contract
   */
  private async pollContractEvents(config: ContractConfig): Promise<void> {
    const { contractId, network, name } = config;
    const client = new SorobanRpcClient(network);

    logger.info({ contractId, network, name }, 'Starting indexer poll loop');
    this.activePollers++;

    try {
      while (!this.shutdownRequested) {
        try {
          // Get cursor position
          const cursor = await this.indexerService.getCursor(contractId, network);
          let startLedger = cursor.lastProcessedLedger;

          // Apply overlap window for reorg protection
          if (startLedger > 0) {
            startLedger = Math.max(0, startLedger - OVERLAP_WINDOW);
          }

          // Get latest ledger from network
          const latestLedger = await client.getLatestLedger();
          const endLedger = Math.min(startLedger + BATCH_SIZE, latestLedger);

          // Skip if we're already caught up
          if (startLedger >= latestLedger) {
            logger.debug(
              { contractId, network, startLedger, latestLedger },
              'Caught up with network, waiting...',
            );
            await this.sleep(POLL_INTERVAL_MS);
            continue;
          }

          // Fetch and process events
          const events = await client.getEvents(contractId, startLedger, endLedger);

          if (events.length > 0) {
            logger.info(
              { contractId, network, eventCount: events.length, startLedger, endLedger },
              'Processing batch of events',
            );

            for (const event of events) {
              await this.processEvent(event, network);
            }

            // Update cursor after batch completes (Issue #258)
            await this.indexerService.recordProgress(contractId, network, endLedger, events.length);
          }

          // Update lag metrics
          await this.indexerService.updateLagMetrics(latestLedger);

          // Wait before next poll
          await this.sleep(POLL_INTERVAL_MS);
        } catch (error) {
          logger.error({ err: error, contractId, network }, 'Error polling contract events');
          await this.indexerService.recordError(contractId, network, error as Error);

          // Back off on error
          await this.sleep(POLL_INTERVAL_MS * 2);
        }
      }
    } finally {
      this.activePollers--;
      logger.info({ contractId, network }, 'Poll loop stopped');
    }
  }

  /**
   * Process a single event and insert into database
   */
  private async processEvent(event: SorobanEvent, network: string): Promise<void> {
    const dto: InsertIndexedEventDTO = {
      eventId: event.id,
      network,
      contractId: event.contractId,
      ledger: event.ledger,
      eventType: event.type,
      eventData: event.value,
      txHash: event.txHash,
    };

    await this.eventService.upsertEvent(dto);
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Wait for all active pollers to finish
   */
  private async waitForShutdown(): Promise<void> {
    const checkInterval = 100; // Check every 100ms
    const maxWait = 30000; // Max 30 seconds
    let waited = 0;

    while (this.activePollers > 0 && waited < maxWait) {
      await this.sleep(checkInterval);
      waited += checkInterval;
    }

    if (this.activePollers > 0) {
      logger.warn(
        { remainingPollers: this.activePollers },
        'Some pollers did not finish in time',
      );
    } else {
      logger.info('All pollers finished gracefully');
    }
  }

  /**
   * Start the indexer worker
   */
  async start(): Promise<void> {
    if (this.contracts.length === 0) {
      logger.error('No contracts configured, indexer will not start');
      return;
    }

    this.setupShutdownHandlers();

    logger.info(
      { contractCount: this.contracts.length, pollInterval: POLL_INTERVAL_MS, batchSize: BATCH_SIZE },
      'Starting indexer worker',
    );

    // Start a poll loop for each contract (Issue #255 - concurrent indexing)
    const pollPromises = this.contracts.map((config) => this.pollContractEvents(config));

    // Wait for all pollers to complete (on shutdown)
    await Promise.all(pollPromises);
    await this.waitForShutdown();

    logger.info('Indexer worker stopped');
  }
}

/**
 * Entry point for running the indexer as a standalone process
 */
export async function startIndexerWorker(): Promise<void> {
  try {
    const worker = new IndexerWorker();
    await worker.start();
  } catch (error) {
    logger.error({ err: error }, 'Failed to start indexer worker');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  startIndexerWorker();
}
