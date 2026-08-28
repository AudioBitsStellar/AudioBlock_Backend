import { Router } from 'express';
import { SubscriptionController } from '../controllers/SubscriptionController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateDTO } from '../middlewares/validate';
import { CreateSubscriptionDTO } from '../dtos/CreateSubscriptionDTO';
import { CreateTrialSubscriptionDTO } from '../dtos/CreateTrialSubscriptionDTO';

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

// Create trial subscription
router.post(
  '/trial',
  validateDTO(CreateTrialSubscriptionDTO),
  subscriptionController.createTrialSubscription,
);

// Convert trial to paid
router.post(
  '/trial/convert',
  subscriptionController.convertTrialToPaid,
);

// Cancel subscription
router.delete('/', subscriptionController.cancelSubscription);

export default router;
