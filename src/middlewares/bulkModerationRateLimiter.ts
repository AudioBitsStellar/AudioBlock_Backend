import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redis from '../config/redis';
import { Request, Response } from 'express';

/**
 * Rate limit for bulk song moderation (Issue #85): at most 5 bulk operations
 * per minute per admin. Keyed on the authenticated admin's id so one admin's
 * burst does not consume another's budget.
 */
const windowMs = parseInt(
  process.env.BULK_MODERATION_RATE_LIMIT_WINDOW_MS || String(60 * 1000),
  10,
);
const max = parseInt(process.env.BULK_MODERATION_RATE_LIMIT_MAX || '5', 10);
const disabled =
  process.env.NODE_ENV === 'test' ||
  process.env.CI === 'true' ||
  process.env.BULK_MODERATION_RATE_LIMIT_ENABLED === 'false';

export const bulkModerationRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => disabled,
  keyGenerator: (req: Request) => {
    const adminId = (req as any).user?.id || req.ip;
    return `moderate:bulk:rl:${adminId}`;
  },
  store: new RedisStore({
    sendCommand: (...args: string[]) => (redis as any).call(...args),
    prefix: 'moderate:bulk:rl:',
  }),
  handler: (req: Request, res: Response) => {
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      success: false,
      message: `Too many bulk moderation requests. Limit is ${max} per ${retryAfterSec}s.`,
      retryAfter: retryAfterSec,
    });
  },
});
