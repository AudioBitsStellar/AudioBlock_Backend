/**
 * Rate limiting middleware for auth endpoints (Issue #29)
 *
 * Applies an IP+email-keyed rate limiter to all authentication routes
 * (/nonce/:email, /register, /login, /register-email, /login-email).
 *
 * When the limit is exceeded, the response is:
 *   HTTP 429 Too Many Requests
 *   Retry-After: <seconds until window resets>
 *
 * Configuration (set in .env, see .env.example):
 *   AUTH_RATE_LIMIT_WINDOW_MS  – sliding window in ms   (default: 15 minutes)
 *   AUTH_RATE_LIMIT_MAX        – max requests per window (default: 20)
 *
 * The limiter uses Redis as its backing store so limits are shared across all
 * application instances / workers.
 */
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redis from '../config/redis';
import { Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';

const windowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10);
const max = parseInt(process.env.AUTH_RATE_LIMIT_MAX || '20', 10);

/**
 * Build a key that combines the client IP with the email present in the
 * request body or route params — so each (IP, email) pair gets its own bucket.
 */
const keyGenerator = (req: Request): string => {
  const email: string =
    req.body?.email ||
    (req.params?.email
      ? Array.isArray(req.params.email)
        ? req.params.email[0]
        : req.params.email
      : '') ||
    'unknown';
  return `auth:rl:${req.ip}:${email}`;
};

export const authRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true, // Return `RateLimit-*` headers
  legacyHeaders: false,
  keyGenerator,
  store: new RedisStore({
    // rate-limit-redis expects a sendCommand function compatible with ioredis
    sendCommand: (...args: string[]) => (redis as any).call(...args),
    prefix: 'auth:rl:',
  }),
  handler: (req: Request, res: Response) => {
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    handleError(
      res,
      AppError.rateLimited('Too many requests. Please try again later.', {
        retryAfter: retryAfterSec,
      }),
    );
  },
});

/**
 * A slightly stricter limiter for the /nonce/:email endpoint, which can be
 * used to enumerate whether an email exists in the system.
 *
 * Configuration:
 *   NONCE_RATE_LIMIT_WINDOW_MS – default: 15 minutes
 *   NONCE_RATE_LIMIT_MAX       – default: 10
 */
const nonceWindowMs = parseInt(
  process.env.NONCE_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000),
  10,
);
const nonceMax = parseInt(process.env.NONCE_RATE_LIMIT_MAX || '10', 10);

export const nonceRateLimiter = rateLimit({
  windowMs: nonceWindowMs,
  max: nonceMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  store: new RedisStore({
    sendCommand: (...args: string[]) => (redis as any).call(...args),
    prefix: 'nonce:rl:',
  }),
  handler: (req: Request, res: Response) => {
    const retryAfterSec = Math.ceil(nonceWindowMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    handleError(
      res,
      AppError.rateLimited('Too many requests. Please try again later.', {
        retryAfter: retryAfterSec,
      }),
    );
  },
});
