/**
 * HTTP request logging middleware (Issue #33)
 *
 * Attaches a unique request-id to every incoming request and logs the method,
 * route, status code and response time as a structured pino record.
 *
 * The generated `req.id` (uuid-like) is also forwarded to the client in the
 * X-Request-Id response header so callers can correlate logs to requests.
 */
import { Request, Response, NextFunction, RequestHandler } from "express";
import { randomUUID } from "crypto";
import logger from "../config/logger";

/** Extend Express Request to carry our correlation id */
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export const requestLoggerMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  req.id = randomUUID();
  res.setHeader("X-Request-Id", req.id);

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level =
      res.statusCode >= 500
        ? "error"
        : res.statusCode >= 400
        ? "warn"
        : "info";

    logger[level](
      {
        reqId: req.id,
        method: req.method,
        route: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
        ip: req.ip,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`
    );
  });

  next();
};
