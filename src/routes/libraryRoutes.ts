import { Router } from 'express';
import { SaveController } from '../controllers/SaveController';
import { requireAuth } from '../middlewares/authMiddleware';

/**
 * Personal library routes mounted at /api/users (Issue #91).
 */
const router = Router();
const saveController = new SaveController();

router.get('/me/library', requireAuth, saveController.getMyLibrary);
router.get('/me/library/collections', requireAuth, saveController.getMyCollections);

export default router;
