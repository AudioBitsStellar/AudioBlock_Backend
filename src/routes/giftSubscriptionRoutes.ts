import { Router } from 'express';
import { GiftSubscriptionController } from '../controllers/GiftSubscriptionController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();
const controller = new GiftSubscriptionController();

// Send a gift subscription
router.post('/gift', requireAuth, controller.sendGift);

// List gifts (sent + received)
router.get('/gifts', requireAuth, controller.listGifts);

// Accept a gift
router.post('/gift/:id/accept', requireAuth, controller.acceptGift);

// Decline a gift
router.post('/gift/:id/decline', requireAuth, controller.declineGift);

export default router;
