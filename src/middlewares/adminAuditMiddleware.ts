import { NextFunction, Request, Response } from 'express';
import logger from '../config/logger';
import { AdminAuditService } from '../services/AdminAuditService';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_PATH_LENGTH = 500;
const MAX_REASON_LENGTH = 1000;

/**
 * Records every mutating admin API request once its response has been sent
 * (#980). Denied and unauthenticated attempts are recorded as well, with a null
 * actor when no user was authenticated.
 *
 * The write is best-effort. A failed audit write is logged at error level and
 * never changes the response the caller receives.
 */
export function adminAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  res.on('finish', () => {
    const body = req.body as { reason?: unknown } | undefined;
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, MAX_REASON_LENGTH) : null;

    AdminAuditService.record({
      actorId: (req as any).user?.id ?? null,
      method: req.method,
      path: req.originalUrl.split('?')[0].slice(0, MAX_PATH_LENGTH),
      statusCode: res.statusCode,
      ipAddress: req.ip ?? null,
      reason,
    }).catch((err) => logger.error({ err, path: req.path }, 'Failed to write admin audit log'));
  });

  next();
}
