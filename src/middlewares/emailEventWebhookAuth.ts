import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Guards the email provider event webhook (`POST /api/email-events/:secret`).
 *
 * Bounce and complaint webhooks cannot carry custom auth headers, so the shared
 * secret travels in the path. The comparison is constant-time. The route fails
 * closed: when EMAIL_EVENTS_WEBHOOK_SECRET is unset, every request gets a 404 and
 * nothing is processed. A wrong secret also gets a 404, so the endpoint does not
 * reveal that it exists. The secret is redacted from request logs.
 */
export function requireEmailEventSecret(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.EMAIL_EVENTS_WEBHOOK_SECRET;
  const provided = typeof req.params.secret === 'string' ? req.params.secret : '';

  const notFound = () =>
    res.status(404).json({ success: false, message: 'Not found', type: 'NOT_FOUND' });

  if (!configured) {
    notFound();
    return;
  }

  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);
  if (
    providedBuffer.length !== configuredBuffer.length ||
    !timingSafeEqual(providedBuffer, configuredBuffer)
  ) {
    notFound();
    return;
  }

  next();
}
