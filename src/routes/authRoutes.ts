import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from 'express';
import { AuthController } from '../controllers/AuthController';
import { requireAuth } from '../middlewares/authMiddleware';
import { authRateLimiter, nonceRateLimiter } from '../middlewares/authRateLimiter';

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
router.post('/2fa/enable', requireAuth, authController.enableTwoFactor);
router.post('/2fa/verify', requireAuth, authController.verifyTwoFactor);
router.post('/2fa/disable', requireAuth, authController.disableTwoFactor);
router.post('/2fa/validate', authRateLimiter, authController.validateTwoFactor);

// Email verification
router.get('/verify-email/:token', authController.verifyEmail);

// Password reset
router.post('/forgot-password', authRateLimiter, authController.forgotPassword);
router.post('/reset-password/:token', authRateLimiter, authController.resetPassword);

export default router;
