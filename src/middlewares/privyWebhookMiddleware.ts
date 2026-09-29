import { Request, Response, NextFunction } from 'express';
import { getPrivyWebhookService } from '../services/privy/PrivyWebhookService';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import logger from '../config/logger';

/**
 * Middleware to verify Privy webhook signatures (Issue #606).
 *
 * This middleware must run BEFORE body-parser JSON middleware, because signature
 * verification requires the raw body buffer. Use express.raw() or similar to
 * capture the raw body first.
 *
 * Security properties:
 * - Rejects webhooks without a valid signature (401)
 * - Rejects webhooks older than 5 minutes (replay protection)
 * - Uses timing-safe comparison to prevent timing attacks
 * - Fails closed: if PRIVY_WEBHOOK_SECRET is not configured, rejects all webhooks
 *
 * @example
 * // In routes/webhookRoutes.ts
 * router.post(
 *   '/privy/user.created',
 *   express.raw({ type: 'application/json' }),
 *   verifyPrivyWebhook,
 *   WebhookController.privyUserCreated
 * );
 */
export const verifyPrivyWebhook = (req: Request, res: Response, next: NextFunction): void => {
  const webhookService = getPrivyWebhookService();

  if (!webhookService) {
    logger.error('PRIVY_WEBHOOK_SECRET not configured, rejecting webhook');
    return handleError(
      req,
      res,
      AppError.authentication('Webhook signature verification is not configured'),
    );
  }

  const signature = req.headers['privy-webhook-signature'] as string | undefined;
  const rawBody = (req as any).rawBody || req.body;

  if (!rawBody) {
    logger.error('Raw body not available for webhook signature verification');
    return handleError(
      req,
      res,
      AppError.authentication('Webhook body missing or middleware misconfigured'),
    );
  }

  const isValid = webhookService.verifySignature(signature, rawBody);

  if (!isValid) {
    logger.warn(
      {
        path: req.path,
        ip: req.ip,
        signaturePresent: !!signature,
      },
      'Privy webhook signature verification failed',
    );
    return handleError(req, res, AppError.authentication('Invalid webhook signature'));
  }

  logger.debug({ path: req.path }, 'Privy webhook signature verified successfully');

  // Parse the verified payload and attach to req.body for downstream handlers
  const payload = webhookService.parsePayload(rawBody);
  if (!payload) {
    return handleError(req, res, AppError.validation('Invalid webhook payload JSON'));
  }

  req.body = payload;
  next();
};
