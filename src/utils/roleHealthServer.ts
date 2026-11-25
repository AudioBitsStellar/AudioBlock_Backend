/**
 * Liveness/readiness probes for the deployables that are not the HTTP API
 * (Issue #965).
 *
 * The API answers /health/live and /health/ready from HealthController because
 * it already runs Express. The worker, indexer and scheduler do not, but a
 * container orchestrator still needs the same two answers for each of them, so
 * every role starts this minimal server on its own port (HEALTH_PORT).
 *
 *   GET /health/live   – process is up. Never touches dependencies, so a slow
 *                        database cannot cause a needless container restart.
 *   GET /health/ready  – the role's own startup work is done (consumer
 *                        connected, poller started, data source initialised).
 *                        503 until then, so a load balancer / scheduler does
 *                        not send work to a process that cannot take it.
 */
import { createServer, Server, ServerResponse } from 'http';
import logger from '../config/logger';

export type DeployableRole = 'api' | 'worker' | 'indexer' | 'scheduler';

/**
 * Default HEALTH_PORT per role. Deployment manifests may override any of them
 * with HEALTH_PORT; the defaults keep the four roles from colliding when they
 * share a host network (and match the Dockerfile HEALTHCHECKs).
 */
export const DEFAULT_HEALTH_PORTS: Record<DeployableRole, number> = {
  api: 4000,
  worker: 9466,
  indexer: 9467,
  scheduler: 9468,
};

export interface RoleHealthServerOptions {
  role: DeployableRole;
  /** Port to bind. Use 0 in tests to get an ephemeral port. */
  port: number;
  /** Interface to bind. Defaults to 0.0.0.0 so a container probe can reach it. */
  host?: string;
  /** Returns true once the role can do its job. Called on every readiness probe. */
  isReady: () => boolean;
}

export interface RoleHealthServer {
  server: Server;
  /** The bound port (resolved when `port` was 0). */
  port: number;
  close: () => Promise<void>;
}

/** Resolve the HEALTH_PORT env var for a role, falling back to its default. */
export function resolveHealthPort(role: DeployableRole): number {
  const raw = process.env.HEALTH_PORT;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HEALTH_PORTS[role];
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function createRoleHealthServer(options: RoleHealthServerOptions): Server {
  const { role, isReady } = options;
  const startedAt = Date.now();

  return createServer((req, res) => {
    // Probes are usually issued as GET; a HEAD probe must answer too.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    const uptimeSeconds = Math.round((Date.now() - startedAt) / 1000);

    if (path === '/' || path === '/health' || path === '/health/live') {
      sendJson(res, 200, { status: 'ok', role, pid: process.pid, uptimeSeconds });
      return;
    }

    if (path === '/health/ready') {
      let ready = false;
      try {
        ready = isReady();
      } catch (err) {
        // A readiness probe that throws is a not-ready signal, not a crash.
        logger.warn({ err, role }, 'Role readiness probe threw');
      }
      sendJson(res, ready ? 200 : 503, {
        status: ready ? 'ok' : 'unavailable',
        role,
        ready,
        uptimeSeconds,
      });
      return;
    }

    sendJson(res, 404, { status: 'not_found', path });
  });
}

/**
 * Bind the role health server. Rejects when the port cannot be bound, so a
 * startup port conflict fails loudly instead of leaving the container
 * "healthy" with no probe listener.
 */
export function startRoleHealthServer(options: RoleHealthServerOptions): Promise<RoleHealthServer> {
  const server = createRoleHealthServer(options);
  const { role, port, host = '0.0.0.0' } = options;

  return new Promise<RoleHealthServer>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      logger.info({ role, port: boundPort }, 'Role health server listening');
      resolve({
        server,
        port: boundPort,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
