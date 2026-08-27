import type { DataSource } from 'typeorm';
import { CircuitBreaker } from '../utils/circuitBreaker';
import { checkDbHealth } from './DbPoolMonitor';
import logger from '../config/logger';

export interface ReconnectConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RECONNECT: ReconnectConfig = {
  maxRetries: 10,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export const dbConnectionState = {
  connected: false,
  reconnecting: false,
  reconnectAttempt: 0,
  lastConnectedAt: null as Date | null,
  lastError: null as string | null,
};

export function getConnectionState() {
  return { ...dbConnectionState };
}

function computeBackoff(attempt: number, config: ReconnectConfig): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}

export async function attemptReconnect(
  dataSource: DataSource,
  config?: Partial<ReconnectConfig>,
): Promise<boolean> {
  const cfg = { ...DEFAULT_RECONNECT, ...config };

  if (dbConnectionState.reconnecting) {
    logger.info('Reconnection already in progress, skipping duplicate attempt');
    return false;
  }

  dbConnectionState.reconnecting = true;
  dbConnectionState.connected = false;

  for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
    dbConnectionState.reconnectAttempt = attempt + 1;
    const delay = computeBackoff(attempt, cfg);

    logger.info(
      { attempt: attempt + 1, maxRetries: cfg.maxRetries, delayMs: delay },
      `Attempting database reconnection (attempt ${attempt + 1}/${cfg.maxRetries})`,
    );

    try {
      if (dataSource.isInitialized) {
        const healthy = await checkDbHealth(dataSource);
        if (healthy) {
          dbConnectionState.connected = true;
          dbConnectionState.reconnecting = false;
          dbConnectionState.lastConnectedAt = new Date();
          dbConnectionState.lastError = null;
          logger.info('Database connection re-established via health check');
          return true;
        }
      }

      await dataSource.initialize();
      dbConnectionState.connected = true;
      dbConnectionState.reconnecting = false;
      dbConnectionState.lastConnectedAt = new Date();
      dbConnectionState.lastError = null;
      logger.info('Database connection re-established');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      dbConnectionState.lastError = message;
      logger.error(
        { attempt: attempt + 1, err: message },
        `Reconnection attempt ${attempt + 1}/${cfg.maxRetries} failed`,
      );
    }

    if (attempt < cfg.maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  dbConnectionState.reconnecting = false;
  logger.error(
    `Failed to reconnect after ${cfg.maxRetries} attempts — circuit breaker will handle fallback`,
  );
  return false;
}

export function createDbCircuitBreaker(dataSource: DataSource): CircuitBreaker {
  const cb = new CircuitBreaker(
    async () => {
      if (!dataSource.isInitialized) return false;
      return checkDbHealth(dataSource);
    },
    {
      failureThreshold: 3,
      resetTimeoutMs: 30000,
      healthCheckIntervalMs: 30000,
    },
  );

  cb.startHealthChecks();
  return cb;
}

export function startConnectionStateLogger(): NodeJS.Timeout {
  const intervalMs = Number(process.env.DB_CONNECTION_STATE_LOG_INTERVAL_MS || 60000);

  const timer = setInterval(() => {
    logger.info(
      {
        connected: dbConnectionState.connected,
        reconnecting: dbConnectionState.reconnecting,
        reconnectAttempt: dbConnectionState.reconnectAttempt,
        lastConnectedAt: dbConnectionState.lastConnectedAt,
        lastError: dbConnectionState.lastError,
      },
      'Database connection state snapshot',
    );
  }, intervalMs);

  if (timer.unref) {
    timer.unref();
  }

  return timer;
}
