import { Router } from 'express';
import { AccountTypeController } from '../controllers/AccountTypeController';
import { requireAuth } from '../middlewares/authMiddleware';
import { authRateLimiter } from '../middlewares/authRateLimiter';

const router = Router();
const controller = new AccountTypeController();

/**
 * Account type management routes (Issue #616).
 *
 * All routes require authentication (either legacy or Privy).
 */

// Get current account type
router.get('/account-type', requireAuth, controller.getAccountType);

// Set or update account type
router.post('/account-type', authRateLimiter, requireAuth, controller.setAccountType);

// Upgrade to artist account (convenience endpoint)
router.post('/upgrade-to-artist', authRateLimiter, requireAuth, controller.upgradeToArtist);

export default router;
