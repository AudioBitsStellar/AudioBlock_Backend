import { Router } from 'express';
import { PrivyWebhookController } from '../controllers/PrivyWebhookController';
import { verifyPrivyWebhookSignature } from '../middlewares/privyWebhookMiddleware';

const router = Router();
const webhookController = new PrivyWebhookController();

/**
 * Privy webhook endpoint (Issues #603-#606, #612, #614).
 *
 * Signature verification middleware (Issue #606) runs first to ensure
 * the request is genuinely from Privy and hasn't been tampered with.
 */
router.post('/webhooks/privy', verifyPrivyWebhookSignature, webhookController.handleWebhook);

export default router;
