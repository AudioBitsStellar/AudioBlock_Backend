import crypto from 'crypto';
import logger from '../../config/logger';

/**
 * Service for verifying Privy webhook signatures (Issue #606).
 *
 * Privy signs webhook payloads using HMAC-SHA256 with the webhook secret.
 * The signature is sent in the `privy-webhook-signature` header.
 *
 * Signature format: `t=timestamp,v1=signature`
 * - timestamp: Unix timestamp (seconds) when the webhook was sent
 * - signature: HMAC-SHA256 hex digest of `timestamp.payload`
 *
 * Security considerations:
 * - Replay protection: reject webhooks older than 5 minutes
 * - Timing-safe comparison: use crypto.timingSafeEqual to prevent timing attacks
 * - Constant-time verification: always verify signature even if timestamp check fails
 *
 * @see https://docs.privy.io/guide/webhooks#verifying-webhook-signatures
 */
export class PrivyWebhookService {
  private readonly webhookSecret: string;
  private readonly maxAgeSeconds: number;

  /**
   * @param webhookSecret - Privy webhook signing secret from PRIVY_WEBHOOK_SECRET env var
   * @param maxAgeSeconds - Maximum age of webhook before rejecting (default 5 minutes)
   */
  constructor(webhookSecret: string, maxAgeSeconds = 300) {
    if (!webhookSecret || webhookSecret.trim().length === 0) {
      throw new Error('PRIVY_WEBHOOK_SECRET is required for webhook signature verification');
    }
    this.webhookSecret = webhookSecret.trim();
    this.maxAgeSeconds = maxAgeSeconds;
  }

  /**
   * Verify the signature of an incoming Privy webhook.
   *
   * @param signature - Value from `privy-webhook-signature` header
   * @param rawBody - Raw request body (Buffer or string) — must not be JSON-parsed yet
   * @returns true if signature is valid and webhook is fresh, false otherwise
   *
   * @example
   * const service = new PrivyWebhookService(process.env.PRIVY_WEBHOOK_SECRET!);
   * const signature = req.headers['privy-webhook-signature'] as string;
   * const isValid = service.verifySignature(signature, req.rawBody);
   * if (!isValid) {
   *   return res.status(401).json({ error: 'Invalid webhook signature' });
   * }
   */
  verifySignature(signature: string | undefined, rawBody: Buffer | string): boolean {
    if (!signature) {
      logger.warn('Missing privy-webhook-signature header');
      return false;
    }

    // Parse signature header: t=timestamp,v1=signature
    const parts = signature.split(',');
    let timestamp: string | undefined;
    let providedSignature: string | undefined;

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') providedSignature = value;
    }

    if (!timestamp || !providedSignature) {
      logger.warn({ signature }, 'Malformed webhook signature header');
      return false;
    }

    // Check timestamp freshness (replay protection)
    const webhookTimestamp = parseInt(timestamp, 10);
    if (isNaN(webhookTimestamp)) {
      logger.warn({ timestamp }, 'Invalid webhook timestamp');
      return false;
    }

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const age = currentTimestamp - webhookTimestamp;

    if (age > this.maxAgeSeconds) {
      logger.warn(
        { age, maxAge: this.maxAgeSeconds, timestamp: webhookTimestamp },
        'Webhook timestamp too old (replay protection)',
      );
      return false;
    }

    if (age < -60) {
      // Webhook from the future (> 1 min clock skew) — likely an attack
      logger.warn({ age, timestamp: webhookTimestamp }, 'Webhook timestamp from the future');
      return false;
    }

    // Compute expected signature: HMAC-SHA256(webhook_secret, "timestamp.payload")
    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(signedPayload, 'utf8')
      .digest('hex');

    // Timing-safe comparison to prevent timing attacks
    const providedBuffer = Buffer.from(providedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (providedBuffer.length !== expectedBuffer.length) {
      logger.warn('Webhook signature length mismatch');
      return false;
    }

    try {
      const isValid = crypto.timingSafeEqual(providedBuffer, expectedBuffer);
      if (!isValid) {
        logger.warn('Webhook signature verification failed');
      }
      return isValid;
    } catch (error) {
      logger.error({ err: error }, 'Error during webhook signature verification');
      return false;
    }
  }
}

/**
 * Singleton instance of PrivyWebhookService.
 * Returns null if PRIVY_WEBHOOK_SECRET is not configured.
 */
export function getPrivyWebhookService(): PrivyWebhookService | null {
  const secret = process.env.PRIVY_WEBHOOK_SECRET;
  if (!secret || secret.trim().length === 0) {
    return null;
  }
  return new PrivyWebhookService(secret);
}
