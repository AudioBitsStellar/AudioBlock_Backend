import { createSlidingWindowLimiter } from './rateLimiter';

const authWindowMs = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10);
const authMax = parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10);

const nonceWindowMs = parseInt(process.env.NONCE_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10);
const nonceMax = parseInt(process.env.NONCE_RATE_LIMIT_MAX || '10', 10);

const passwordResetWindowMs = parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS || String(60 * 60 * 1000), 10);
const passwordResetMax = parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_MAX || '3', 10);

export const authRateLimiter = createSlidingWindowLimiter(authWindowMs, authMax, 'auth:rl', (req) => {
  const email = req.body?.email || (req.params?.email ? (Array.isArray(req.params.email) ? req.params.email[0] : req.params.email) : '') || 'unknown';
  return `auth:rl:${req.ip}:${email}`;
});

export const nonceRateLimiter = createSlidingWindowLimiter(nonceWindowMs, nonceMax, 'nonce:rl', (req) => {
  const email = req.body?.email || (req.params?.email ? (Array.isArray(req.params.email) ? req.params.email[0] : req.params.email) : '') || 'unknown';
  return `nonce:rl:${req.ip}:${email}`;
});

export const passwordResetRateLimiter = createSlidingWindowLimiter(passwordResetWindowMs, passwordResetMax, 'pwreset:rl', (req) => {
  const email = req.body?.email || (req.params?.email ? (Array.isArray(req.params.email) ? req.params.email[0] : req.params.email) : '') || 'unknown';
  return `pwreset:rl:${req.ip}:${email}`;
});
