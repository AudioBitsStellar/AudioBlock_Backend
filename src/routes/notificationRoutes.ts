import { Router } from 'express';
import { NotificationController } from '../controllers/NotificationController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// Notifications are personal, so every route requires authentication (Issue #79, #427).
router.get('/', requireAuth, NotificationController.list);
router.get('/preferences', requireAuth, NotificationController.getPreferences);
router.put('/preferences', requireAuth, NotificationController.updatePreferences);
router.put('/:id/read', requireAuth, NotificationController.markAsRead);
router.post('/read-all', requireAuth, NotificationController.markAllAsRead);

export default router;
