/**
 * Standalone entry point for the indexer worker (`npm run worker:indexer`).
 *
 * Initializes the database, starts the concurrent per-contract pollers, and
 * keeps the process alive until it receives SIGINT/SIGTERM.
 */
import 'reflect-metadata';
import AppDataSource from '../../config/db';
import { IndexerWorker } from './IndexerWorker';
import logger from '../../config/logger';

let worker: IndexerWorker | null = null;

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down indexer worker');
  worker?.stop();
  const finish = async (): Promise<void> => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy().catch(() => undefined);
    }
    process.exit(0);
  };
  void finish();
}

export async function main(): Promise<void> {
  await AppDataSource.initialize();
  logger.info('Indexer worker connected to database');

  worker = new IndexerWorker();
  worker.start();

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'Indexer worker failed to start');
    process.exit(1);
  });
}
