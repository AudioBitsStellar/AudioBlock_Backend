import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import logger from '../config/logger';
import { PrivyWebhookService } from '../services/privy/PrivyWebhookService';
import redis from '../config/redis';

/**
 * Middleware to verify Privy webhook signatures (Issue #606).
 *
 * Privy signs webhook payloads using HMAC-SHA256 with your app secret.
 * This middleware verifies the signature before processing the webhook.
 *
 * The signature is sent in the `privy-signature` header in the format:
 * `t=<timestamp>,v1=<signature>`
 *
 * Security considerations:
 * - Timestamp check prevents replay attacks (5-minute window)
 * - Constant-time comparison prevents timing attacks
 * - Signature verification ensures payload integrity
 */
export function verifyPrivyWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  const signatureHeader = req.headers['privy-signature'];
  const signature = typeof signatureHeader === 'string' ? signatureHeader : undefined;
  const webhookSecret = process.env.PRIVY_WEBHOOK_SECRET || process.env.PRIVY_APP_SECRET;

  if (!webhookSecret) {
    logger.error('PRIVY_WEBHOOK_SECRET not configured');
    return handleError(req, res, AppError.businessLogic('Privy webhooks not configured'));
  }

  if (!signature) {
    logger.warn('Missing Privy webhook signature');
    return handleError(req, res, AppError.authentication('Missing webhook signature'));
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.warn('Raw body unavailable for Privy webhook signature verification');
    return handleError(req, res, AppError.authentication('Unable to verify webhook signature'));
  }

  const verifier = new PrivyWebhookService(webhookSecret);
  if (!verifier.verifySignature(signature, rawBody)) {
    return handleError(req, res, AppError.authentication('Invalid webhook signature'));
  }

  next();
}

export const verifyPrivyWebhook = verifyPrivyWebhookSignature;

/** Atomically reserve a webhook ID so concurrent deliveries cannot process twice. */
export async function deduplicatePrivyWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const headerId = req.headers['svix-id'];
  const webhookId = typeof headerId === 'string' ? headerId : undefined;
  if (!webhookId) {
    return next();
  }

  const key = `privy:webhook:processed:${webhookId}`;
  try {
    const reservation = await redis.set(key, 'processing', 'EX', 24 * 60 * 60, 'NX');
    if (reservation !== 'OK') {
      logger.info({ webhookId }, 'Duplicate Privy webhook delivery ignored');
      res.status(200).json({ success: true, received: true });
      return;
    }
  } catch (error) {
    logger.error({ err: error, webhookId }, 'Unable to reserve Privy webhook ID');
    handleError(req, res, AppError.externalService('Webhook deduplication is unavailable'));
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      void redis.del(key).catch((error: unknown) => {
        logger.error({ err: error, webhookId }, 'Unable to release failed Privy webhook ID');
      });
    }
    return originalJson(body);
  };
  next();
}
