import { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import logger from '../config/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key'];

const SENSITIVE_BODY_FIELDS = /password|token|secret|key|signature|pin|otp|code|recovery/i;

const MAX_BODY_LOG_BYTES = 1024;

function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[max-depth]';
  if (typeof obj === 'string') return obj;
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactSensitive(v, depth + 1));
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_BODY_FIELDS.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitive(value, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

function truncateBody(body: unknown): unknown {
  if (!body) return undefined;
  const serialized = JSON.stringify(redactSensitive(body));
  if (serialized.length > MAX_BODY_LOG_BYTES) {
    return serialized.slice(0, MAX_BODY_LOG_BYTES) + '...';
  }
  try {
    return JSON.parse(serialized);
  } catch {
    return serialized;
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

  if (logger.level === 'debug') {
    const body = truncateBody(req.body);
    if (body) {
      logger.debug({ reqId: req.id, body }, 'request body');
    }
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    const userId = (req as any).user?.id;

    const redactedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
        redactedHeaders[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        redactedHeaders[key] = value;
      } else if (Array.isArray(value)) {
        redactedHeaders[key] = value.join(', ');
      }
    }

    logger[level](
      {
        timestamp: new Date().toISOString(),
        reqId: req.id,
        method: req.method,
        route: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
        ip: req.ip,
        userId,
        ...(req.headers['content-length']
          ? { requestBodyBytes: Number(req.headers['content-length']) }
          : {}),
      },
      `${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`,
    );
  });

  next();
};
