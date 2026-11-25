/**
 * Standalone entry point for the indexer worker (`npm run worker:indexer`).
 *
 * Initializes the database, starts the concurrent per-contract pollers, and
 * keeps the process alive until it receives SIGINT/SIGTERM.
 *
 * Projection of raw events into read models runs as its own loop, decoupled
 * from ingestion (Issue #261): a projector failure never blocks raw event
 * storage, and projections can be rebuilt with `npm run cli:project`.
 */
import 'reflect-metadata';
import { createServer, Server } from 'http';
import AppDataSource from '../../config/db';
import { IndexerWorker } from './IndexerWorker';
import { EventProjector } from '../../services/EventProjector';
import logger from '../../config/logger';
import { getMetrics, getMetricsContentType } from '../../services/MetricsService';
import {
  RoleHealthServer,
  resolveHealthPort,
  startRoleHealthServer,
} from '../../utils/roleHealthServer';

const PROJECTOR_INTERVAL_MS = parseInt(process.env.INDEXER_PROJECTOR_INTERVAL_MS || '15000', 10);
const METRICS_PORT = parseInt(process.env.INDEXER_METRICS_PORT || '9464', 10);

let worker: IndexerWorker | null = null;
let projectorTimer: NodeJS.Timeout | null = null;
let metricsServer: Server | null = null;
let healthServer: RoleHealthServer | null = null;

/**
 * Prometheus scrape endpoint for this deployable (Issue #965). Health probes
 * live on their own port so a scrape outage or stdout scrape config can never
 * make the container look unhealthy.
 */
export function startMetricsServer(port: number = METRICS_PORT): Server {
  const server = createServer((req, res) => {
    if ((req.url || '/').split('?')[0] === '/metrics') {
      void (async () => {
        try {
          const [body, contentType] = await Promise.all([getMetrics(), getMetricsContentType()]);
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(body);
        } catch (err) {
          logger.error({ err }, 'Failed to render indexer metrics');
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('metrics unavailable');
        }
      })();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  server.on('error', (err) => logger.error({ err, port }, 'Indexer metrics server error'));
  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Indexer metrics server listening');
  });
  return server;
}

/**
 * Periodically apply new raw events to all projections. Skips a tick if the
 * previous run is still in flight.
 */
export function startProjectorLoop(
  projector: EventProjector,
  intervalMs: number = PROJECTOR_INTERVAL_MS,
): NodeJS.Timeout {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await projector.catchUp();
    } catch (err) {
      logger.error({ err }, 'Event projector run failed');
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(() => void tick(), intervalMs);
}

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down indexer worker');
  worker?.stop();
  if (projectorTimer) clearInterval(projectorTimer);
  const finish = async (): Promise<void> => {
    if (healthServer) {
      await healthServer.close().catch(() => undefined);
      healthServer = null;
    }
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

// Issue #247: new subsystem against production contracts should be
// reversible without a deploy. Defaults off until rollout is validated.
function isIndexerEnabled(): boolean {
  return ['true', '1'].includes((process.env.INDEXER_ENABLED || '').toLowerCase());
}

export async function main(): Promise<void> {
  if (!isIndexerEnabled()) {
    logger.info('Indexer worker disabled (set INDEXER_ENABLED=true to start it)');
    return;
  }

  await AppDataSource.initialize();
  logger.info('Indexer worker connected to database');

  startMetricsServer();
  worker = new IndexerWorker();
  worker.start();
  projectorTimer = startProjectorLoop(new EventProjector());

  // Readiness follows the poller, not merely the TCP listener: a process that
  // is up but has not started indexing must not receive a probe's "all good".
  healthServer = await startRoleHealthServer({
    role: 'indexer',
    port: resolveHealthPort('indexer'),
    isReady: () => worker !== null && AppDataSource.isInitialized,
  });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'Indexer worker failed to start');
    process.exit(1);
  });
}
