/**
 * Standalone entry point for the indexer worker (`npm run worker:indexer`).
 *
 * Initializes the database, starts the concurrent per-contract pollers, and
 * keeps the process alive until it receives SIGINT/SIGTERM.
 */
import 'reflect-metadata';
import { createServer, Server } from 'http';
import AppDataSource from '../../config/db';
import { IndexerWorker } from './IndexerWorker';
import logger from '../../config/logger';
import { getMetrics, getMetricsContentType } from '../../services/MetricsService';

let worker: IndexerWorker | null = null;
let metricsServer: Server | null = null;

function startMetricsServer(): void {
  const port = Number(process.env.INDEXER_METRICS_PORT || 9464);
  metricsServer = createServer((request, response) => {
    if (request.method !== 'GET' || request.url?.split('?')[0] !== '/metrics') {
      response.writeHead(404).end();
      return;
    }

    void (async () => {
      try {
        const [contentType, metrics] = await Promise.all([getMetricsContentType(), getMetrics()]);
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(metrics);
      } catch (error) {
        logger.error({ err: error }, 'Failed to render indexer metrics');
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Metrics temporarily unavailable');
      }
    })();
  });
  metricsServer.on('error', (error) =>
    logger.error({ err: error }, 'Indexer metrics server failed'),
  );
  metricsServer.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Indexer metrics server listening');
  });
}

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down indexer worker');
  worker?.stop();
  const finish = async (): Promise<void> => {
    if (metricsServer) {
      await new Promise<void>((resolve) => metricsServer?.close(() => resolve()));
      metricsServer = null;
    }
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

  startMetricsServer();
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
