import { Router } from 'express';
import express from 'express';
import { WebhookController } from '../controllers/WebhookController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateDTO } from '../middlewares/validate';
import { CreateWebhookSubscriptionDTO } from '../dtos/WebhookSubscriptionDTO';
import { verifyPrivyWebhook } from '../middlewares/privyWebhookMiddleware';

const router = Router();

// All webhook subscription management requires authentication (any role)
router.post(
  '/register',
  requireAuth,
  validateDTO(CreateWebhookSubscriptionDTO),
  WebhookController.register,
);
router.get('/', requireAuth, WebhookController.list);
router.delete('/:id', requireAuth, WebhookController.remove);
router.post('/:id/test', requireAuth, WebhookController.testDelivery);

// Privy webhook handlers (Issues #603, #604, #605, #606)
// These endpoints receive webhooks from Privy for user lifecycle events
// Issue #606: Webhook signature verification added to prevent unauthorized webhook requests
// Raw body middleware captures the body before JSON parsing for signature verification
router.post(
  '/privy/user.created',
  express.raw({ type: 'application/json' }),
  verifyPrivyWebhook,
  WebhookController.privyUserCreated,
);
router.post(
  '/privy/user.updated',
  express.raw({ type: 'application/json' }),
  verifyPrivyWebhook,
  WebhookController.privyUserUpdated,
);
router.post(
  '/privy/user.linked_account',
  express.raw({ type: 'application/json' }),
  verifyPrivyWebhook,
  WebhookController.privyUserLinkedAccount,
);

export default router;
