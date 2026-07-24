/**
 * Structured logger configuration (Issue #33)
 *
 * Uses pino for structured, levelled logging with request correlation.
 * Log level is controlled via the LOG_LEVEL env var (default: "info").
 *
 * Usage:
 *   import logger from './config/logger';
 *   logger.info({ reqId, route: req.path, status: 200 }, 'Request complete');
 *   logger.error({ reqId, err }, 'Something failed');
 *
 * Log levels (set LOG_LEVEL=debug|info|warn|error):
 *   debug – verbose dev-time output
 *   info  – normal operational events (default)
 *   warn  – non-fatal anomalies
 *   error – failures that need attention
 */
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Pretty-print in development, JSON in production/CI
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  }),
  base: {
    service: "audioblock-backend",
    env: process.env.NODE_ENV || "development",
  },
});

export default logger;
