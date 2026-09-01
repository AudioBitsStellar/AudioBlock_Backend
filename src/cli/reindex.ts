#!/usr/bin/env ts-node
/**
 * Reindex CLI tool (Issue #256)
 *
 * Allows replaying/reindexing a specific ledger range for debugging
 * missed or malformed events.
 *
 * Safety guarantees:
 * - Does NOT mutate the live indexer cursor
 * - Writes/updates IndexedEvent rows idempotently
 * - Can be run in dry-run mode (read-only)
 *
 * Usage:
 *   npm run cli:reindex -- \
 *     --contract <CONTRACT_ID> \
 *     --network <mainnet|testnet> \
 *     --from <START_LEDGER> \
 *     --to <END_LEDGER> \
 *     [--dry-run]
 */

import { IndexedEventService, InsertIndexedEventDTO } from '../services/IndexedEventService';
import AppDataSource from '../config/db';
import logger from '../config/logger';

interface ReindexOptions {
  contract: string;
  network: string;
  from: number;
  to: number;
  dryRun?: boolean;
}

interface SorobanEvent {
  id: string;
  ledger: number;
  contractId: string;
  type: string;
  value: Record<string, unknown>;
  txHash?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ReindexOptions | null {
  const args = process.argv.slice(2);
  const options: Partial<ReindexOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--contract' && i + 1 < args.length) {
      options.contract = args[++i];
    } else if (arg === '--network' && i + 1 < args.length) {
      options.network = args[++i];
    } else if (arg === '--from' && i + 1 < args.length) {
      options.from = parseInt(args[++i], 10);
    } else if (arg === '--to' && i + 1 < args.length) {
      opt
  // Validate parameters
  if (from < 0) {
    throw new Error('Start ledger (--from) must be >= 0');
  }

  if (to < from) {
    throw new Error('End ledger (--to) must be >= start ledger (--from)');
  }

  const ledgerRange = to - from;
  if (ledgerRange > 10000) {
    logger.warn(
      { ledgerRange },
      'Large ledger range detected. Consider breaking into smaller batches.',
    );
  }

  // Initialize database connection
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const eventSerWORK>         Network (mainnet or testnet)
  --from <LEDGER>            Start ledger number
  --to <LEDGER>              End ledger number

Optional:
  --dry-run                   Read-only mode, no database writes

Examples:
  npm run cli:reindex -- --contract CXXX... --network mainnet --from 1000000 --to 1001000
  npm run cli:reindex -- --contract CXXX... --network testnet --from 500000 --to 501000 --dry-run
  `);
}

/**
 * Mock Soroban RPC client for fetching events
 * TODO: Replace with actual SorobanService integration
 */
class SorobanRpcClient {
  private rpcUrl: string;

  constructor(network: string) {
    this.rpcUrl =
      network === 'mainnet'
        ? process.env.SOROBAN_RPC_URL_MAINNET || 'https://soroban-mainnet.stellar.org'
        : process.env.SOROBAN_RPC_URL_TESTNET || 'https://soroban-testnet.stellar.org';
  }

  async getEvents(
    contractId: string,
    startLedger: number,
    endLedger: number,
  ): Promise<SorobanEvent[]> {
    // TODO: Implement actual RPC call
    logger.debug(
      { contractId, startLedger, endLedger, rpcUrl: this.rpcUrl },
      'Fetching events for reindex',
    );
    return [];
  }
}

/**
 * Reindex a specific ledger range
 */
async function reindexRange(options: ReindexOptions): Promise<void> {
  const { contract, network, from, to, dryRun } = options;

  logger.info({ contract, network, from, to, dryRun }, 'Starting reindex operation');

  // Validate parameters
  if (from < 0) {
    throw new Error('Start ledger (--from) must be >= 0');
  }

  if (to < from) {
    throw new Error('End ledger (--to) must be >= start ledger (--from)');
  }

  const ledgerRange = to - from;
  if (ledgerRange > 10000) {
    logger.warn(
      { ledgerRange },
      'Large ledger range detected. Consider breaking into smaller batches.',
    );
  }

  // Initialize database connection
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const eventService = new IndexedEventService();
  const client = new SorobanRpcClient(network);

  let totalEvents = 0;
  let processedEvents = 0;
  const batchSize = 100;

  try {
    // Process in batches
    for (let currentLedger = from; currentLedger < to; currentLedger += batchSize) {
      const endLedger = Math.min(currentLedger + batchSize, to);

      logger.info(
        { currentLedger, endLedger, progress: `${currentLedger - from}/${ledgerRange}` },
        'Fetching batch',
      );

      const events = await client.getEvents(contract, currentLedger, endLedger);
      totalEvents += events.length;

      if (events.length === 0) {
        logger.debug({ currentLedger, endLedger }, 'No events in batch');
        continue;
      }

      logger.info({ eventCount: events.length }, 'Processing batch events');

      for (const event of events) {
        if (dryRun) {
          logger.info({ event }, '[DRY RUN] Would insert/update event');
        } else {
          const dto: InsertIndexedEventDTO = {
            eventId: event.id,
            network,
            contractId: event.contractId,
            ledger: event.ledger,
            eventType: event.type,
            eventData: event.value,
            txHash: event.txHash,
          };

          await eventService.upsertEvent(dto);
          processedEvents++;
        }
      }

      // Progress update
      if ((currentLedger - from) % 1000 === 0) {
        logger.info(
          {
            processed: currentLedger - from,
            total: ledgerRange,
            eventsFound: totalEvents,
          },
          'Reindex progress',
        );
      }
    }

    // Summary
    logger.info(
      {
        contract,
        network,
        fromLedger: from,
        toLedger: to,
        totalEvents,
        processedEvents: dryRun ? 0 : processedEvents,
        dryRun,
      },
      'Reindex complete',
    );

    if (dryRun) {
      logger.info('Dry run mode: No database changes were made');
    } else {
      logger.info(
        `Successfully reindexed ${processedEvents} events. Live cursor was NOT modified.`,
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'Reindex operation failed');
    throw error;
  }
}

/**
 * Main CLI entry point
 */
async function main() {
  const options = parseArgs();

  if (!options) {
    printUsage();
    process.exit(1);
  }

  try {
    await reindexRange(options);
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Reindex failed');
    process.exit(1);
  }
}

// Run CLI if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { reindexRange };
