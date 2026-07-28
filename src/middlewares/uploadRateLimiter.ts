import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redis from '../config/redis';
import { Request, Response } from 'express';

const uploadWindowMs = parseInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10);
const uploadMax = parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || '10', 10);
const uploadLimiterDisabled =
  process.env.NODE_ENV === 'test' ||
  process.env.CI === 'true' ||
  process.env.UPLOAD_RATE_LIMIT_ENABLED === 'false';

export const uploadRateLimiter = rateLimit({
  windowMs: uploadWindowMs,
  max: uploadMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => uploadLimiterDisabled,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id || req.ip;
    return `upload:rl:${userId}`;
  },
  store: new RedisStore({
    sendCommand: (...args: string[]) => (redis as any).call(...args),
    prefix: 'upload:rl:',
  }),
  handler: (req: Request, res: Response) => {
    const retryAfterSec = Math.ceil(uploadWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      success: false,
      message: 'Too many upload requests. Please try again later.',
      retryAfter: retryAfterSec,
    });
  },
});
