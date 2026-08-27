import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { requireAuth } from '../middlewares/authMiddleware';
import {
  authRateLimiter,
  nonceRateLimiter,
  passwordResetRateLimiter,
  twoFactorRateLimiter,
} from '../middlewares/authRateLimiter';

const authController = new AuthController();
const router = Router();

// Apply IP+email-keyed rate limiting to all auth routes (Issue #29).
// /nonce/:email gets its own, stricter limiter to prevent email enumeration.
router.get('/nonce/:email', nonceRateLimiter, authController.getUserNonce);
router.post('/register', authRateLimiter, authController.register);
router.post('/register-listener', authRateLimiter, authController.registerListener);
router.post('/login', authRateLimiter, authController.login);

// Email + password auth (no wallet signature required) — coexists with the
// wallet-signature flow above. Either path issues the same JWT shape.
router.post('/register-email', authRateLimiter, authController.registerWithEmail);
router.post('/login-email', authRateLimiter, authController.loginWithEmail);
router.post('/refresh', authRateLimiter, authController.refreshToken);
router.post('/logout', authRateLimiter, authController.logout);
// Issue #328: rate-limited per authenticated user — previously unthrottled.
router.post('/2fa/enable', requireAuth, twoFactorRateLimiter, authController.enableTwoFactor);
router.post('/2fa/verify', requireAuth, twoFactorRateLimiter, authController.verifyTwoFactor);
router.post('/2fa/disable', requireAuth, twoFactorRateLimiter, authController.disableTwoFactor);
router.post('/2fa/validate', authRateLimiter, authController.validateTwoFactor);

// Email verification
router.get('/verify-email/:token', authController.verifyEmail);

// Password reset
// /forgot-password is throttled to 3 requests/hour/email (Issue #102) to prevent
// inbox flooding and reset-token brute-forcing.
router.post('/forgot-password', passwordResetRateLimiter, authController.forgotPassword);
router.post('/reset-password/:token', authRateLimiter, authController.resetPassword);

export default router;
