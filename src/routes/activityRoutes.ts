import { Router } from 'express';
import { ActivityController } from '../controllers/ActivityController';
import { requireAuth, optionalAuth } from '../middlewares/authMiddleware';

const router = Router();

router.get('/onchain', ActivityController.getOnChainActivity);
router.get('/', optionalAuth, ActivityController.getActivityFeed);
router.get('/feed/me', requireAuth, ActivityController.getMyFeed);
router.get('/users/:id/activities', ActivityController.getUserActivities);

export default router;
