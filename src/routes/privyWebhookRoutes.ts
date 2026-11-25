import { Router, json } from 'express';
import { PrivyWebhookController } from '../controllers/PrivyWebhookController';
import {
  deduplicatePrivyWebhook,
  verifyPrivyWebhookSignature,
} from '../middlewares/privyWebhookMiddleware';

const router = Router();
const webhookController = new PrivyWebhookController();
const captureRawBody = json({
  verify(req, _res, buffer) {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
});

/**
 * Privy webhook endpoint (Issues #603-#606, #612, #614).
 *
 * Signature verification middleware (Issue #606) runs first to ensure
 * the request is genuinely from Privy and hasn't been tampered with.
 */
router.post(
  '/webhooks/privy',
  captureRawBody,
  verifyPrivyWebhookSignature,
  deduplicatePrivyWebhook,
  webhookController.handleWebhook,
);

export default router;
