/**
 * Database connection pool monitor (Issue #134)
 * ─────────────────────────────────────────────
 * Provides operational visibility into the TypeORM/node-postgres connection
 * pool:
 *
 *   • Periodic pool metrics logging (active / idle / waiting).
 *   • Health-check query on the pool so stale connections are detected early.
 *   • A warning log when the pool is exhausted (all connections in use with
 *     requests waiting).
 *   • A `getPoolStats` helper backing the pool status health endpoint.
 *
 * Configuration (env vars):
 *   DB_POOL_METRICS_INTERVAL_MS – how often to log metrics / run the health
 *                                 check on idle connections (default 30000).
 */
import type { DataSource } from "typeorm";
import logger from "../config/logger";
import { dbPoolConfig } from "../config/db";

export interface PoolStats {
  /** Configured maximum pool size. */
  max: number;
  /** Configured minimum pool size. */
  min: number;
  /** Total connections currently created by the pool. */
  total: number;
  /** Connections that are idle (available for use). */
  idle: number;
  /** Connections currently checked out and in use. */
  active: number;
  /** Requests waiting for a connection to become available. */
  waiting: number;
}

const METRICS_INTERVAL_MS = Number(
  process.env.DB_POOL_METRICS_INTERVAL_MS || 30000
);

let metricsTimer: NodeJS.Timeout | null = null;

/**
 * Reach through TypeORM to the underlying node-postgres Pool. The pg Pool
 * exposes `totalCount`, `idleCount` and `waitingCount`. Returns null when the
 * driver isn't a pg pool (e.g. before initialization or under test mocks).
 */
function getPgPool(dataSource: DataSource): any | null {
  const master = (dataSource?.driver as any)?.master;
  if (master && typeof master.totalCount === "number") return master;
  return null;
}

/** Snapshot the current pool state. Used by the pool status health endpoint. */
export function getPoolStats(dataSource: DataSource): PoolStats {
  const pool = getPgPool(dataSource);
  const total = pool?.totalCount ?? 0;
  const idle = pool?.idleCount ?? 0;
  const waiting = pool?.waitingCount ?? 0;

  return {
    max: dbPoolConfig.max,
    min: dbPoolConfig.min,
    total,
    idle,
    active: Math.max(total - idle, 0),
    waiting,
  };
}

/**
 * Run a lightweight health-check query. Returns true when the pool can serve a
 * query, false otherwise. Kept cheap (`SELECT 1`) so it can run frequently
 * without load impact.
 */
export async function checkDbHealth(dataSource: DataSource): Promise<boolean> {
  try {
    await dataSource.query("SELECT 1");
    return true;
  } catch (err) {
    logger.error({ err }, "Database health check query failed");
    return false;
  }
}

/**
 * Start periodic pool metrics logging + health checks. Safe to call once after
 * the DataSource has been initialized. Returns a stop function.
 */
export function startDbPoolMonitor(dataSource: DataSource): () => void {
  if (metricsTimer) return stopDbPoolMonitor;

  const tick = async () => {
    const stats = getPoolStats(dataSource);

    // Warn when the pool is exhausted: every connection in use AND callers are
    // queued waiting for one. This is the signal that the pool is undersized
    // for current load.
    if (stats.waiting > 0 && stats.active >= stats.max) {
      logger.warn(
        stats,
        `DB pool exhausted: ${stats.active}/${stats.max} connections in use, ${stats.waiting} request(s) waiting`
      );
    } else {
      logger.info(stats, "DB pool metrics");
    }

    // Health-check the pool so a broken/stale connection surfaces in logs
    // rather than failing a user request first.
    await checkDbHealth(dataSource);
  };

  metricsTimer = setInterval(() => {
    void tick();
  }, METRICS_INTERVAL_MS);

  // Don't keep the process alive solely for the metrics timer.
  if (typeof metricsTimer.unref === "function") metricsTimer.unref();

  logger.info(
    { intervalMs: METRICS_INTERVAL_MS, ...dbPoolConfig },
    "DB pool monitor started"
  );

  return stopDbPoolMonitor;
}

export function stopDbPoolMonitor(): void {
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}
