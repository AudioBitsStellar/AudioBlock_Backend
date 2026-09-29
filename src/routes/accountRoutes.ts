import { Router } from 'express';
import { AccountController } from '../controllers/AccountController';
import { requireAuth } from '../middlewares/authMiddleware';
import { accountLifecycleRateLimiter } from '../middlewares/authRateLimiter';

const accountController = new AccountController();
const router = Router();

/**
 * GDPR account lifecycle (Issue #633).
 *
 * Every route is `requireAuth` + `accountLifecycleRateLimiter`: these act on the
 * caller's own account only, and the limiter bounds how fast a compromised
 * session can act. There is intentionally no `/:userId` variant — the subject of
 * every request is the bearer, so the route surface cannot be aimed at another
 * account.
 */
router.use(requireAuth, accountLifecycleRateLimiter);

/** Art. 15/20 — full copy of the caller's personal data. */
router.get('/data', accountController.exportData);

/** Art. 17 — schedule erasure, cancellable until the grace period ends. */
router.post('/deletion-request', accountController.requestDeletion);
router.delete('/deletion-request', accountController.cancelDeletion);
router.get('/deletion-status', accountController.getDeletionStatus);

/** Issue #617 — fetch current authenticated user profile. */
router.get('/profile', accountController.getProfile);

/** Issue #618 — update user profile after authentication. */
router.put('/profile', accountController.updateProfile);

/** Issue #619 — detect and merge duplicate accounts. */
router.get('/duplicates', accountController.detectDuplicates);
router.post('/merge', accountController.mergeAccounts);

export default router;
