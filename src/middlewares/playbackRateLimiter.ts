import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redis from '../config/redis';
import { Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';

const windowMs = 30 * 1000; // 30 seconds
const max = 1; // 1 request per 30 seconds

const keyGenerator = (req: Request): string => {
  const songId = req.params.id || 'unknown';
  const userId = (req as any).user?.id || req.ip;
  return `playback:rl:${songId}:${userId}`;
};

export const playbackRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  store: new RedisStore({
    sendCommand: (...args: string[]) => (redis as any).call(...args),
    prefix: 'playback:rl:',
  }),
  handler: (req: Request, res: Response) => {
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    // We don't throw an error to prevent breaking clients, 
    // instead we could just send a 200 indicating it was deduped, 
    // but the pattern usually involves 429. Let's return 429.
    handleError(
      res,
      AppError.rateLimited('Playback recorded recently. Please wait before recording again.', {
        retryAfter: retryAfterSec,
      }),
    );
  },
});
