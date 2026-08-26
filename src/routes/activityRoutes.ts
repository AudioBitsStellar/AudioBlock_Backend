import { Router } from 'express';
import { ActivityController } from '../controllers/ActivityController';
import { requireAuth, authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.get('/', authMiddleware, ActivityController.getActivityFeed);
router.get('/feed/me', requireAuth, ActivityController.getMyFeed);
router.get('/users/:id/activities', ActivityController.getUserActivities);

export default router;
