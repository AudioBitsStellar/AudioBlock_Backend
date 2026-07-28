import type { Server } from 'http';
import AppDataSource from '../config/db';
import logger from '../config/logger';
import redis from '../config/redis';

interface ShutdownHook {
  name: string;
  close: () => Promise<void>;
}

interface ShutdownState {
  shuttingDown: boolean;
  server: Server | null;
  hooks: ShutdownHook[];
}

const state: ShutdownState = {
  shuttingDown: false,
  server: null,
  hooks: [],
};

export function isShuttingDown(): boolean {
  return state.shuttingDown;
}

export function registerServer(server: Server): void {
  state.server = server;
}

export function registerShutdownHook(name: string, close: () => Promise<void>): void {
  state.hooks.push({ name, close });
}

async function performShutdown(signal: string): Promise<void> {
  if (state.shuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress, ignoring duplicate signal');
    return;
  }

  state.shuttingDown = true;
  logger.warn({ signal }, `Received ${signal} — starting graceful shutdown`);

  const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 30000);
  let forceExit = false;

  const forceTimer = setTimeout(() => {
    forceExit = true;
    logger.error('Shutdown timed out after 30s — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  try {
    if (state.server) {
      logger.info('Stopping HTTP server — no longer accepting new requests');
      await new Promise<void>((resolve) => {
        state.server!.close(() => resolve());
      });
      logger.info('HTTP server closed');
    }
  } catch (err) {
    logger.error({ err }, 'Error closing HTTP server');
  }

  for (const hook of state.hooks) {
    try {
      logger.info(`Running shutdown hook: ${hook.name}`);
      await hook.close();
      logger.info(`Shutdown hook complete: ${hook.name}`);
    } catch (err) {
      logger.error({ err, hook: hook.name }, 'Shutdown hook failed');
    }
  }

  if (!forceExit) {
    clearTimeout(forceTimer);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  }
}

function isFatalRejection(reason: unknown): boolean {
  const fatalNames = [
    'EvalError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'TypeError',
    'URIError',
  ];
  return reason instanceof Error && fatalNames.includes(reason.name);
}

export function attachProcessHandlers(): void {
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error({ reason, promise: String(promise) }, 'Unhandled promise rejection');
    if (isFatalRejection(reason)) {
      logger.error({ reason }, 'Fatal unhandled rejection detected — initiating graceful shutdown');
      performShutdown('unhandledRejection');
    }
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error({ err: error }, 'Uncaught exception — initiating graceful shutdown');
    performShutdown('uncaughtException');
  });

  process.on('SIGTERM', () => {
    performShutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    performShutdown('SIGINT');
  });
}

export async function closeDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
    logger.info('Database connection pool closed');
  }
}

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
    logger.info('Redis connection closed');
  } catch (err) {
    logger.error({ err }, 'Error closing Redis connection');
  }
}

export async function drainWorkerQueues(): Promise<void> {
  logger.info('Worker queue drain hook — stub (RabbitMQ channel auto-closes on disconnect)');
}
