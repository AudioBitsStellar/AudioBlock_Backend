/**
 * Structured error logging with request context (Issue #122).
 *
 * Every 5xx (and 4xx) error response should go through logRequestError()
 * so logs consistently carry: timestamp (added by pino), method, path,
 * user id, correlation id, client IP, and — for the first occurrence of a
 * given error within a 5-minute window — the full stack trace and a
 * redacted snapshot of the request body at debug level. Repeat occurrences
 * of the same error+route within that window are logged as a single
 * lightweight line carrying the running count, rather than repeating the
 * full payload every time.
 *
 * Fire-and-forget: this never returns a promise callers need to await, so
 * call sites (which are almost all synchronous res.json() paths) don't
 * need to change shape. The Redis round-trip for dedup happens after the
 * response has already been sent to the client.
 */
import { Request } from 'express';
import crypto from 'crypto';
import logger from '../config/logger';
import redis from '../config/redis';
import { redactSensitiveFields } from './redact';

const DEDUP_WINDOW_SECONDS = Math.max(
  1,
  Math.round(parseInt(process.env.ERROR_DEDUP_WINDOW_MS || String(5 * 60 * 1000), 10) / 1000),
);

function errorNameAndMessage(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (typeof error === 'string') {
    return { name: 'NonError', message: error };
  }
  return { name: 'NonError', message: 'Unknown error' };
}

function routeIdentity(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
}

function buildFingerprint(error: unknown, req: Request): string {
  const { name, message } = errorNameAndMessage(error);
  const raw = `${name}:${message}:${req.method}:${routeIdentity(req)}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

/** Returns this fingerprint's occurrence count within the dedup window (fails open to 1 if Redis is unavailable). */
async function nextDedupCount(fingerprint: string): Promise<number> {
  try {
    const key = `errlog:dedup:${fingerprint}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, DEDUP_WINDOW_SECONDS);
    }
    return count;
  } catch (err) {
    logger.warn(
      { err, fingerprint },
      'Error dedup counter unavailable, logging as first occurrence',
    );
    return 1;
  }
}

export function logRequestError(req: Request, error: unknown, statusCode: number): void {
  const level: 'warn' | 'error' = statusCode >= 500 ? 'error' : 'warn';
  const fingerprint = buildFingerprint(error, req);

  const baseContext = {
    reqId: req.id,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    userId: req.user?.id,
    ip: req.ip,
    fingerprint,
  };

  nextDedupCount(fingerprint)
    .then((count) => {
      if (count > 1) {
        logger[level](
          { ...baseContext, count, message: errorNameAndMessage(error).message },
          'Duplicate error suppressed',
        );
        return;
      }

      logger[level]({ ...baseContext, count, err: error }, 'Request error');
      logger.debug({ reqId: req.id, body: redactSensitiveFields(req.body) }, 'Request body');
    })
    .catch((err) => {
      logger.warn({ err }, 'Failed to log request error');
    });
}
