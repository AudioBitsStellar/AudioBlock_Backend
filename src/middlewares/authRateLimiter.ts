import { createSlidingWindowLimiter } from './rateLimiter';

const authWindowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10);
const authMax = parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10);

const nonceWindowMs = parseInt(
  process.env.NONCE_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000),
  10,
);
const nonceMax = parseInt(process.env.NONCE_RATE_LIMIT_MAX || '10', 10);

const passwordResetWindowMs = parseInt(
  process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS || String(60 * 60 * 1000),
  10,
);
const passwordResetMax = parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_MAX || '3', 10);

export const authRateLimiter = createSlidingWindowLimiter(
  authWindowMs,
  authMax,
  'auth:rl',
  (req) => {
    const email =
      req.body?.email ||
      (req.params?.email
        ? Array.isArray(req.params.email)
          ? req.params.email[0]
          : req.params.email
        : '') ||
      'unknown';
    return `auth:rl:${req.ip}:${email}`;
  },
);

export const nonceRateLimiter = createSlidingWindowLimiter(
  nonceWindowMs,
  nonceMax,
  'nonce:rl',
  (req) => {
    const email =
      req.body?.email ||
      (req.params?.email
        ? Array.isArray(req.params.email)
          ? req.params.email[0]
          : req.params.email
        : '') ||
      'unknown';
    return `nonce:rl:${req.ip}:${email}`;
  },
);

export const passwordResetRateLimiter = createSlidingWindowLimiter(
  passwordResetWindowMs,
  passwordResetMax,
  'pwreset:rl',
  (req) => {
    const email =
      req.body?.email ||
      (req.params?.email
        ? Array.isArray(req.params.email)
          ? req.params.email[0]
          : req.params.email
        : '') ||
      'unknown';
    return `pwreset:rl:${req.ip}:${email}`;
  },
);

// 2FA enable/verify/disable (issue #328): previously had no dedicated
// limiter at all beyond requireAuth, unlike every other auth-adjacent
// route in this file — an authenticated attacker could brute-force a TOTP
// code or spam enable/disable toggles with no throttling. Keyed by the
// authenticated user (set by requireAuth), since these routes always run
// after auth and per-user throttling is the meaningful boundary here (an
// IP-only key would let one user with a rotating IP evade it, and would
// also throttle unrelated users sharing a NAT'd IP).
const twoFactorWindowMs = parseInt(
  process.env.TWO_FACTOR_RATE_LIMIT_WINDOW_MS || String(60 * 1000),
  10,
);
const twoFactorMax = parseInt(process.env.TWO_FACTOR_RATE_LIMIT_MAX || '5', 10);

export const twoFactorRateLimiter = createSlidingWindowLimiter(
  twoFactorWindowMs,
  twoFactorMax,
  '2fa:rl',
  (req) => {
    const userId = (req as any).user?.id || 'unknown';
    return `2fa:rl:${userId}`;
  },
);
