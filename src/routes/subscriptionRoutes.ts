import { Router } from 'express';
import { SubscriptionController } from '../controllers/SubscriptionController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateDTO } from '../middlewares/validate';
import { CreateSubscriptionDTO } from '../dtos/CreateSubscriptionDTO';

const router = Router();
const subscriptionController = new SubscriptionController();

// All subscription routes require authentication
router.use(requireAuth);

// Get current user's subscription
router.get('/me/subscription', subscriptionController.getMySubscription);

// Create or upgrade subscription
router.post(
  '/',
  validateDTO(CreateSubscriptionDTO),
  subscriptionController.createOrUpgradeSubscription,
);

// Cancel subscription
router.delete('/', subscriptionController.cancelSubscription);

export default router;
