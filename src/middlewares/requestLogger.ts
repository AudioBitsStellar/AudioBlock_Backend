/**
 * HTTP request logging middleware (Issue #33)
 *
 * Attaches a unique request-id to every incoming request (honoring an
 * incoming X-Request-Id header when present) and logs the method, route,
 * status code and response time as a structured pino record.
 *
 * The resulting `req.id` is also forwarded to the client in the
 * X-Request-Id response header so callers can correlate logs to requests.
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import logger from '../config/logger';

/** Extend Express Request to carry our correlation id */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export const requestLoggerMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const incomingId = req.headers['x-request-id'];
  req.id = (typeof incomingId === 'string' && incomingId) || randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](
      {
        reqId: req.id,
        method: req.method,
        route: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
        ip: req.ip,
        // #109 — surfaces large payloads for monitoring even when they're
        // within the configured limit (and thus never hit the 413 path).
        requestBodyBytes: req.headers['content-length']
          ? Number(req.headers['content-length'])
          : undefined,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`,
    );
  });

  next();
};
