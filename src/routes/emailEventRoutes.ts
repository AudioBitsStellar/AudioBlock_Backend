import { Router } from 'express';
import { EmailEventController } from '../controllers/EmailEventController';
import { requireEmailEventSecret } from '../middlewares/emailEventWebhookAuth';

const router = Router();
const emailEventController = new EmailEventController();

/**
 * Email provider bounce, complaint and drop webhook (issue PROD-03).
 * Point Resend or SendGrid at `<API>/api/email-events/<EMAIL_EVENTS_WEBHOOK_SECRET>`.
 * See docs/EMAIL_DELIVERABILITY.md.
 */
router.post('/:secret', requireEmailEventSecret, emailEventController.handleProviderEvents);

export default router;
