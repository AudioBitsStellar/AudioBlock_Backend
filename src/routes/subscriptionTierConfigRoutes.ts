import { Router } from 'express';
import { SubscriptionTierConfigController } from '../controllers/SubscriptionTierConfigController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();
const controller = new SubscriptionTierConfigController();

// Public: list configured tiers
router.get('/tiers', controller.listTiers);

// Admin: create/update a tier
router.put('/tiers/:tier', requireAuth, controller.upsertTier);

// Admin: delete a tier
router.delete('/tiers/:tier', requireAuth, controller.deleteTier);

export default router;
